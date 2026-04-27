"""Thin coordination layer: paper CRUD + pipeline dispatch + localize + decide/investigate."""
from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional

from app.config import settings
from app.models import (
    BoundingBox,
    Dimension,
    DimensionScore,
    Exchange,
    ExchangeRole,
    Finding,
    FindingDecision,
    LocalizeStatus,
    Paper,
    PaperFlag,
    PaperStatus,
    PaperSummary,
    PipelineStep,
    ProofBlock,
    ReviewDraft,
    ReviewStage,
    ReviewStyleSnapshot,
    RunState,
    SegmentStatus,
    TriageReport,
    TriageVerdict,
    VenueType,
)
from app.pipeline.steps.triage import triage_paper
from app.pipeline.runner import run_full_pipeline
from app.pipeline.steps.clarity import clarity_pass
from app.pipeline.steps.literature import literature_pass
from app.pipeline.steps.localize import localize_findings_on_page
from app.pipeline.steps.numerical import numerical_pass
from app.pipeline.steps.verify_proofs import verify_blocks_batched
from app.services.events import bus
from app.services.llm_client import LLMClient, usage_tracker
from app.services.mineru_client import MinerUClient
from app.services.storage import FileStore
from app.services.vision_client import VisionClient

logger = logging.getLogger(__name__)


class Orchestrator:
    def __init__(
        self,
        store: FileStore,
        llm: LLMClient,
        mineru: MinerUClient,
        vision: VisionClient,
        folder_store: Optional["FolderStore"] = None,
    ) -> None:
        self.store = store
        self.llm = llm
        self.mineru = mineru
        self.vision = vision
        # v3 — folder CRUD lives in its own JSON store. Default-construct
        # one rooted at the same data dir as the paper store so existing
        # callers (tests, main app) don't need to wire it explicitly.
        from app.services.folder_store import FolderStore as _FolderStore
        from app.services.profile_store import ProfileStore as _ProfileStore
        self.folder_store = folder_store or _FolderStore(self.store.base)
        self.profile_store = _ProfileStore(self.store.base)
        # Per-paper lock so we don't clobber findings while user mutates them.
        self._locks: dict[str, asyncio.Lock] = {}
        # Per-paper stop signal; set by stop(), cleared by resume().
        self._stop_events: dict[str, asyncio.Event] = {}

    def _lock(self, paper_id: str) -> asyncio.Lock:
        lk = self._locks.get(paper_id)
        if lk is None:
            lk = asyncio.Lock()
            self._locks[paper_id] = lk
        return lk

    def _stop_event(self, paper_id: str) -> asyncio.Event:
        ev = self._stop_events.get(paper_id)
        if ev is None:
            ev = asyncio.Event()
            self._stop_events[paper_id] = ev
        return ev

    # -- paper CRUD -----------------------------------------------------------

    def create_paper(
        self,
        filename: str,
        pdf_bytes: bytes,
        *,
        venue_type: VenueType = VenueType.journal,
        venue_name: Optional[str] = None,
        folder: Optional[str] = None,
        review_style: Optional[ReviewStyleSnapshot] = None,
    ) -> Paper:
        # status=analyzing keeps the existing /status semantics meaningful
        # (frontend's "isAnalyzing" predicate stays true through triage).
        # stage=uploaded → triaging will be flipped by the triage task as it
        # starts; this keeps the just-uploaded snapshot honest.
        paper = Paper(
            filename=filename,
            status=PaperStatus.analyzing,
            step=PipelineStep.parse,
            step_index=0,
            venue_type=venue_type,
            venue_name=venue_name,
            folder=folder,
            review_style=review_style,
            stage=ReviewStage.uploaded,
        )
        self.store.save_pdf(paper.paper_id, pdf_bytes)
        self.store.save_paper(paper)
        return paper

    def get_paper(self, paper_id: str) -> Optional[Paper]:
        return self.store.load_paper(paper_id)

    def list_papers(self) -> List[PaperSummary]:
        return self.store.list_papers()

    def delete_paper(self, paper_id: str) -> bool:
        ok = self.store.delete_paper(paper_id)
        self._locks.pop(paper_id, None)
        return ok

    def set_folder(self, paper_id: str, folder: Optional[str]) -> Optional[Paper]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        cleaned = folder.strip() if isinstance(folder, str) else None
        paper.folder = cleaned or None
        paper.updated_at = _now()
        self.store.save_paper(paper)
        return paper

    # -- v3 folders -----------------------------------------------------------

    def list_folders(self):
        return self.folder_store.list()

    def create_folder(self, name: str, venue_type=None):
        folder = self.folder_store.create(name, venue_type)
        if folder is not None:
            bus.emit("_global", "folder.created", {"folder": folder.model_dump(mode="json")})
        return folder

    def rename_folder(self, old: str, new: str):
        """Rename folder + cascade onto every `paper.folder == old`. Returns
        the renamed Folder, None on 404, or the string "collision" if the
        new name is already taken (so the route can map to a 409)."""
        existing = self.folder_store.get(old)
        if existing is None:
            return None
        if old != new and self.folder_store.get(new) is not None:
            return "collision"
        folder = self.folder_store.rename(old, new)
        if folder is None:
            return None
        if old != new:
            # Cascade: every paper currently in `old` moves to `new`.
            for summary in self.store.list_papers():
                if summary.folder != old:
                    continue
                paper = self.store.load_paper(summary.paper_id)
                if not paper:
                    continue
                paper.folder = new
                paper.updated_at = _now()
                self.store.save_paper(paper)
            bus.emit("_global", "folder.renamed", {"old": old, "new": new})
        return folder

    def update_folder_venue_type(self, name: str, venue_type):
        return self.folder_store.update_venue_type(name, venue_type)

    # -- v3 onboarding --------------------------------------------------------

    def get_onboarding(self):
        return self.profile_store.get()

    def submit_onboarding(self, profile_in):
        """Idempotent on `name`. First-time submission seeds one folder per
        `default_venue`; subsequent POSTs just update the profile and
        do not touch folders (user may have renamed/deleted them since).
        Returns the saved OnboardingProfile."""
        from app.models import OnboardingProfile as _OB
        profile = _OB(
            name=profile_in.name,
            role=profile_in.role,
            field=profile_in.field,
            research_interests=list(getattr(profile_in, "research_interests", []) or []),
            default_venues=list(profile_in.default_venues or []),
            default_review_style=profile_in.default_review_style,
        )
        # First-time only: seed folders from default_venues. Skip duplicates
        # (the canonical defaults — Journal/Conference/Grant/Thesis — already
        # exist as is_default=True from the seed; users add NeurIPS/JASA/etc.
        # via this path).
        if not self.profile_store.has_seeded_folders():
            for venue in profile.default_venues:
                name = (venue or "").strip()
                if not name:
                    continue
                self.create_folder(name)  # silently no-ops on duplicate
            self.profile_store.mark_folders_seeded()
        self.profile_store.save(profile)
        bus.emit("_global", "onboarding.completed", {
            "profile": profile.model_dump(mode="json"),
        })
        return profile

    def delete_folder(self, name: str):
        """Delete a folder + clear `paper.folder` for matching papers.
        Returns the deleted Folder, None on 404, or "default" if the
        folder is `is_default=True` (route maps to 409)."""
        target = self.folder_store.get(name)
        if target is None:
            return None
        if target.is_default:
            return "default"
        deleted = self.folder_store.delete(name)
        if deleted is None:
            return None
        for summary in self.store.list_papers():
            if summary.folder != name:
                continue
            paper = self.store.load_paper(summary.paper_id)
            if not paper:
                continue
            paper.folder = None
            paper.updated_at = _now()
            self.store.save_paper(paper)
        bus.emit("_global", "folder.deleted", {"name": name})
        return deleted

    def set_flag(
        self,
        paper_id: str,
        flag: Optional[PaperFlag],
    ) -> Optional[Paper]:
        """Idempotent set of paper.flag. Setting promising clears rejected
        (and vice versa) by virtue of overwriting; passing None clears the
        flag. Stage and other fields are untouched. Emits `flag.set` SSE."""
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        if paper.flag == flag:
            # No-op: don't bump updated_at or emit on a redundant call.
            return paper
        paper.flag = flag
        paper.updated_at = _now()
        self.store.save_paper(paper)
        bus.emit(paper_id, "flag.set", {
            "paper_id": paper_id,
            "flag": flag.value if flag else None,
        })
        return paper

    # -- pipeline dispatch ----------------------------------------------------

    async def run_pipeline_task(self, paper_id: str) -> None:
        """Entry point for the background task kicked from POST /v1/papers/{id}/dive-deep
        and POST /v1/papers/{id}/resume. v2: this is the *deep dive* now —
        upload no longer kicks it directly (triage runs first)."""
        paper = self.store.load_paper(paper_id)
        if not paper:
            logger.warning("run_pipeline_task: paper %s disappeared", paper_id)
            return

        ev = self._stop_event(paper_id)
        ev.clear()

        try:
            await run_full_pipeline(
                paper, self.store, self.llm, self.mineru, self.vision, ev,
            )
        except Exception:
            logger.exception("Unhandled error in pipeline task for %s", paper_id)
            return

        # Reload to pick up the runner's persisted state, then run the v2
        # dimension passes (literature, clarity, numerical) — these don't
        # need MinerU and are independent of the per-segment loop, so we
        # fire them once after segment work completes.
        paper = self.store.load_paper(paper_id)
        if paper and paper.status == PaperStatus.ready:
            try:
                await self._run_dimension_passes(paper_id)
            except Exception:
                logger.exception("dimension passes failed for %s", paper_id)
                # Don't block the dived flip on a dimension-pass failure —
                # the paper still has proof findings + a triage report and
                # the user can generate a review on what's there.

        # On clean completion, flip the v2 stage flag so the workspace
        # surfaces "Generate review" instead of "Dive Deep".
        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if paper and paper.status == PaperStatus.ready:
                paper.stage = ReviewStage.dived
                paper.updated_at = _now()
                self.store.save_paper(paper)
                bus.emit(paper_id, "dive.completed", {})

    async def _run_dimension_passes(self, paper_id: str) -> None:
        """Run literature/clarity/numerical in parallel, append findings,
        then derive base scores for all 6 dimensions."""
        paper = self.store.load_paper(paper_id)
        if not paper:
            return

        # All three passes are independent and read paper.markdown — fire
        # in parallel for ~3x latency savings.
        results = await asyncio.gather(
            literature_pass(paper, self.llm),
            clarity_pass(paper, self.llm),
            numerical_pass(paper, self.llm),
            return_exceptions=True,
        )
        lit_findings = results[0] if isinstance(results[0], list) else []
        cla_findings = results[1] if isinstance(results[1], list) else []
        num_findings = results[2] if isinstance(results[2], list) else []
        for r, name in zip(results, ("literature", "clarity", "numerical")):
            if isinstance(r, Exception):
                logger.exception("dimension pass %s raised: %s", name, r)

        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return
            for f in lit_findings + cla_findings + num_findings:
                paper.findings.append(f)
                bus.emit(paper_id, "finding.created", {
                    "segment_id": None,
                    "finding": f.model_dump(mode="json"),
                })

            # Derive base scores for all 6 dimensions from the now-complete
            # finding list + triage report.
            paper.dimension_scores = self._compute_base_scores(paper)
            paper.updated_at = _now()
            self.store.save_paper(paper)

        for ds in paper.dimension_scores:
            bus.emit(paper_id, "dimension.scored", {
                "dimension": ds.dimension.value,
                "score": ds.score,
                "rationale": ds.rationale,
            })

    @staticmethod
    def _compute_base_scores(paper: Paper) -> List[DimensionScore]:
        """Per §3.3 of the v2 plan, dimension_base is a neutral starting
        point and the user's decisions are the *only* adjustment that
        moves it. Pre-penalizing the base with finding counts double-counts
        once `_adjust_scores` overlays the per-decision deltas.

        Choice: hold base at 9.0 for the four pass-driven dimensions
        (proof / literature / clarity / numerical). Findings are still
        attached via `finding_ids`, so `_adjust_scores` can score them
        once the user agrees or dismisses each one. Frontend uses the
        identical formula client-side, so the live preview now matches
        what `finalize-review` will eventually freeze.

        Relevance + novelty stay derived from the triage prior, since no
        dedicated pass emits findings for those.
        """
        # Bucket finding ids by dimension so /scores can attribute deltas.
        by_dim: Dict[Dimension, List[Finding]] = {d: [] for d in Dimension}
        for f in paper.findings:
            by_dim.setdefault(f.dimension, []).append(f)

        triage = paper.triage
        verdict_prior = {"high": 8.0, "medium": 6.0, "low": 4.0}
        prior = verdict_prior.get(
            triage.verdict.value if triage else "medium", 6.0
        )

        # Neutral base for pass-driven dimensions. 9.0 leaves a small
        # headroom so dismissed findings can still nudge upward toward 10.
        BASE_NEUTRAL = 9.0

        out: List[DimensionScore] = []
        for dim in Dimension:
            findings = by_dim.get(dim, [])
            ids = [f.finding_id for f in findings]
            if dim in (Dimension.proof, Dimension.literature, Dimension.clarity, Dimension.numerical):
                score = BASE_NEUTRAL
                rationale = (
                    f"{len(findings)} finding(s) flagged "
                    f"(H/M/L: {sum(1 for f in findings if f.severity.value=='high')}/"
                    f"{sum(1 for f in findings if f.severity.value=='medium')}/"
                    f"{sum(1 for f in findings if f.severity.value=='low')}). "
                    "Score moves as you agree or dismiss each one."
                )
            elif dim == Dimension.relevance:
                score = prior
                rationale = (triage.venue_match if triage else "No venue match analysis available.")[:200]
            else:  # novelty
                score = prior
                rationale = (triage.novelty if triage else "No novelty analysis available.")[:200]
            out.append(DimensionScore(
                dimension=dim,
                score=round(score, 2),
                rationale=rationale,
                finding_ids=ids,
            ))
        return out

    # -- v2 triage ------------------------------------------------------------

    async def triage_task(self, paper_id: str) -> None:
        """Background triage on upload. Runs PyMuPDF + 1 Sonnet call
        (~$0.02–0.05). Persists `paper.triage` and flips `paper.stage` to
        `triaged`. Emits `triage.started/completed/failed` SSE."""
        paper = self.store.load_paper(paper_id)
        if not paper:
            logger.warning("triage_task: paper %s disappeared", paper_id)
            return
        pdf_bytes = self.store.load_pdf(paper_id)
        if not pdf_bytes:
            logger.warning("triage_task: PDF missing for %s", paper_id)
            return

        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return
            paper.stage = ReviewStage.triaging
            paper.updated_at = _now()
            self.store.save_paper(paper)
        bus.emit(paper_id, "triage.started", {})

        try:
            report: TriageReport = await triage_paper(paper, pdf_bytes, self.llm)
        except Exception as e:
            logger.exception("triage_task: failed for %s", paper_id)
            async with self._lock(paper_id):
                p = self.store.load_paper(paper_id)
                if p:
                    p.stage = ReviewStage.uploaded  # back to safe state
                    p.updated_at = _now()
                    self.store.save_paper(p)
            bus.emit(paper_id, "triage.failed", {"error": str(e)})
            return

        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return
            paper.triage = report
            paper.stage = ReviewStage.triaged
            paper.updated_at = _now()
            self.store.save_paper(paper)
        bus.emit(paper_id, "triage.completed", {
            "verdict": report.verdict.value,
            "confidence": report.confidence,
        })

    def dive_deep(self, paper_id: str) -> tuple[Optional[Paper], bool]:
        """Flip the paper to `diving` so the runner picks it up.

        Returns `(paper, scheduled)`:
          - `(None, False)` on 404
          - `(paper, False)` if already diving/dived (idempotent no-op)
          - `(paper, True)`  on a fresh transition — caller must schedule
            `run_pipeline_task` via FastAPI BackgroundTasks.

        Kept synchronous so tests can call it without an event loop.
        """
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None, False
        if paper.stage in (ReviewStage.diving, ReviewStage.dived):
            return paper, False
        if paper.stage not in (ReviewStage.triaged, ReviewStage.uploaded):
            return paper, False
        self._stop_event(paper_id).clear()
        paper.stage = ReviewStage.diving
        # Leave run_state alone — the runner's planning step (run_planning)
        # only fires when run_state ∈ {idle, failed}. If we pre-flipped it
        # to running, planning would be skipped and the pipeline would
        # complete with 0 segments.
        paper.updated_at = _now()
        self.store.save_paper(paper)
        bus.emit(paper_id, "dive.started", {})
        return paper, True

    # -- stop / resume --------------------------------------------------------

    def stop(self, paper_id: str) -> Optional[Paper]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        if paper.run_state not in (RunState.running, RunState.planning):
            return paper  # already stopped / completed / failed — no-op
        self._stop_event(paper_id).set()
        paper.run_state = RunState.paused
        paper.updated_at = _now()
        self.store.save_paper(paper)
        bus.emit(paper_id, "run.paused", {"reason": "user"})
        return paper

    def resume(self, paper_id: str) -> Optional[Paper]:
        """Flip run_state back to running + clear the stop flag.

        Does NOT kick the background task — the route handler is responsible
        for that (via FastAPI BackgroundTasks), so we don't need an event
        loop here. Keeps the method synchronous and callable from tests.
        """
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        if paper.run_state == RunState.completed:
            return paper
        if paper.run_state not in (RunState.stopped, RunState.paused, RunState.failed, RunState.idle):
            return paper  # already running
        self._stop_event(paper_id).clear()
        paper.run_state = RunState.running
        paper.updated_at = _now()
        self.store.save_paper(paper)
        bus.emit(paper_id, "run.resumed", {})
        return paper

    def reanalyze(self, paper_id: str) -> Optional[Paper]:
        """Prepare the paper for an incremental re-verify pass.

        Flips status/run_state to analyzing/running and clears the stop flag.
        The actual work runs in `reanalyze_task` as a background task. No
        existing findings, drafts, markdown, or proof_blocks are touched.
        """
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        if not paper.proof_blocks:
            return paper  # nothing to re-verify
        self._stop_event(paper_id).clear()
        paper.status = PaperStatus.analyzing
        paper.run_state = RunState.running
        paper.updated_at = _now()
        self.store.save_paper(paper)
        bus.emit(paper_id, "run.reanalyze_started", {
            "proof_block_count": len(paper.proof_blocks),
        })
        return paper

    async def reanalyze_task(self, paper_id: str) -> None:
        """Background re-verify + localize over all existing proof_blocks.

        Appends any new findings to paper.findings. Existing findings are
        left intact; dedupe is left to the user (dismiss duplicates). Cost
        accumulates on segment.llm_cost_usd, same way the initial run does.
        """
        paper = self.store.load_paper(paper_id)
        if not paper or not paper.proof_blocks:
            return

        try:
            cost_before = usage_tracker.cost_usd
            new_findings = await verify_blocks_batched(
                paper.proof_blocks,
                paper.stable_digest or paper.markdown,
                self.llm,
                paper_markdown=paper.markdown,
            )
            verify_cost = usage_tracker.cost_usd - cost_before
        except Exception:
            logger.exception("reanalyze_task: verify failed for %s", paper_id)
            async with self._lock(paper_id):
                p = self.store.load_paper(paper_id)
                if p:
                    p.status = PaperStatus.ready
                    p.run_state = RunState.completed
                    p.updated_at = _now()
                    self.store.save_paper(p)
            return

        # Attribute the re-verify cost across segments that contributed
        # proof_blocks, proportional to block count. Keeps `by_segment` in
        # the cost report reflective of where work happened.
        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return
            proof_segs = [
                s for s in paper.segments if s.proof_block_ids
            ]
            total_blocks = sum(len(s.proof_block_ids) for s in proof_segs) or 1
            for seg in proof_segs:
                share = verify_cost * (len(seg.proof_block_ids) / total_blocks)
                seg.llm_cost_usd += share
            # Append new findings + bind to the segment owning each proof block.
            block_to_seg: Dict[str, str] = {}
            for seg in paper.segments:
                for bid in seg.proof_block_ids:
                    block_to_seg[bid] = seg.segment_id
            appended: List[Finding] = []
            for f in new_findings:
                paper.findings.append(f)
                sid = block_to_seg.get(f.proof_block_id)
                if sid:
                    seg = paper.segment(sid)
                    if seg:
                        seg.finding_ids.append(f.finding_id)
                appended.append(f)
                bus.emit(paper_id, "finding.created", {
                    "segment_id": block_to_seg.get(f.proof_block_id),
                    "finding": f.model_dump(mode="json"),
                })
            paper.updated_at = _now()
            self.store.save_paper(paper)

        # Localize new findings page-by-page, same as the initial pipeline.
        paper = self.store.load_paper(paper_id)
        if paper and appended:
            by_page: dict = {}
            for f in appended:
                by_page.setdefault(f.page, []).append(f)
            for page_num, fs in sorted(by_page.items()):
                cost_before = usage_tracker.cost_usd
                try:
                    await localize_findings_on_page(paper, fs, self.store, self.vision)
                except Exception:
                    logger.exception("reanalyze_task: localize failed on p.%s", page_num)
                # Attribute localize cost to the segment owning each finding.
                localize_cost = usage_tracker.cost_usd - cost_before
                if localize_cost and fs:
                    per_finding = localize_cost / len(fs)
                    for f in fs:
                        sid = block_to_seg.get(f.proof_block_id)
                        if sid:
                            seg = paper.segment(sid)
                            if seg:
                                seg.llm_cost_usd += per_finding
                for f in fs:
                    bus.emit(paper_id, "localize.completed", {
                        "segment_id": block_to_seg.get(f.proof_block_id),
                        "finding_id": f.finding_id,
                        "localize_status": f.localize_status.value,
                        "bbox": f.bbox.model_dump(mode="json") if f.bbox else None,
                    })
            paper.updated_at = _now()
            self.store.save_paper(paper)

        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if paper:
                paper.status = PaperStatus.ready
                paper.run_state = RunState.completed
                paper.updated_at = _now()
                self.store.save_paper(paper)
                bus.emit(paper_id, "run.reanalyze_completed", {
                    "new_findings": len(appended),
                })
                bus.emit(paper_id, "pipeline.done", {})

    def skip_segment(self, paper_id: str, segment_id: str) -> Optional[Paper]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        seg = paper.segment(segment_id)
        if not seg:
            return None
        if seg.status not in (SegmentStatus.pending,):
            return paper
        seg.status = SegmentStatus.skipped
        seg.finished_at = _now()
        paper.updated_at = _now()
        self.store.save_paper(paper)
        bus.emit(paper_id, "segment.skipped", {"segment_id": segment_id})
        return paper

    def include_segment(self, paper_id: str, segment_id: str) -> Optional[Paper]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        seg = paper.segment(segment_id)
        if not seg:
            return None
        if seg.status != SegmentStatus.skipped:
            return paper
        seg.status = SegmentStatus.pending
        if seg.priority <= 0:
            seg.priority = 5  # give it a moderate priority if upgrading from skip
        paper.updated_at = _now()
        self.store.save_paper(paper)
        bus.emit(paper_id, "segment.included", {"segment_id": segment_id})
        return paper

    # -- cost report ----------------------------------------------------------

    def build_cost_report(self, paper_id: str):
        from app.models import CostReport, SegmentCostBreakdown
        from app.services.pricing import SERVICE_MARKUP, bill_user
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None

        by_segment = [
            SegmentCostBreakdown(
                segment_id=s.segment_id,
                label=s.label,
                page_start=s.page_start,
                page_end=s.page_end,
                classification=s.classification,
                status=s.status,
                llm_cost_usd=round(s.llm_cost_usd, 6),
                gpu_cost_usd=round(s.gpu_cost_usd, 6),
                cost_subtotal_usd=s.cost_subtotal_usd(),
            )
            for s in paper.segments
        ]
        running_raw = paper.total_cost_raw()
        pending_cost = _estimate_remaining(paper)
        total_estimate_raw = running_raw + pending_cost

        llm_tokens = {
            "input": 0, "cache_write": 0, "cache_read": 0, "output": 0,
        }
        # Two-bucket stage breakdown aggregated from segment data. More
        # granular (outline / extract / verify / localize) would require a
        # per-paper token tracker; for now we report the two buckets we can
        # accurately measure and let the UI render whatever keys appear.
        by_stage: dict = {
            "mineru_gpu": round(paper.total_gpu_cost_raw(), 6),
            "llm": round(paper.total_llm_cost_raw(), 6),
        }
        return CostReport(
            running_raw_usd=round(running_raw, 4),
            running_billed_usd=bill_user(running_raw),
            estimate_remaining_raw_usd=round(pending_cost, 4),
            estimate_total_raw_usd=round(total_estimate_raw, 4),
            estimate_total_billed_usd=bill_user(total_estimate_raw),
            markup_factor=SERVICE_MARKUP,
            by_stage=by_stage,
            by_segment=by_segment,
            llm_tokens=llm_tokens,
        )


    # -- localize -------------------------------------------------------------

    async def localize_one(self, paper_id: str, finding_id: str) -> Optional[Finding]:
        """Single-finding localize — calls the batched vision with N=1."""
        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None
            finding = paper.finding(finding_id)
            if not finding:
                return None
            await localize_findings_on_page(paper, [finding], self.store, self.vision)
            paper.updated_at = _now()
            self.store.save_paper(paper)
            bus.emit(paper_id, "localize.completed", {
                "finding_id": finding.finding_id,
                "localize_status": finding.localize_status.value,
            })
            return finding

    async def localize_all(self, paper_id: str) -> None:
        """Group pending findings by page → one batched vision call per page."""
        paper = self.store.load_paper(paper_id)
        if not paper:
            return

        by_page: dict[int, list] = {}
        for f in paper.findings:
            # Re-run for anything that isn't terminally placed. soft_deleted is
            # a legacy marker from the vision-first era — ignore it so old
            # findings re-surface deterministically.
            if f.localize_status == LocalizeStatus.user_placed:
                continue
            if f.parse_version == paper.parse_version and f.localize_status in (
                LocalizeStatus.done, LocalizeStatus.not_located, LocalizeStatus.quote_unverified,
            ):
                continue
            by_page.setdefault(f.page, []).append(f)
        if not by_page:
            return

        sem = asyncio.Semaphore(max(1, settings.localize_concurrency))

        async def _one_page(page_number: int, finding_ids: list[str]) -> None:
            async with sem:
                try:
                    async with self._lock(paper_id):
                        p = self.store.load_paper(paper_id)
                        if not p:
                            return
                        findings = [p.finding(fid) for fid in finding_ids]
                        findings = [f for f in findings if f is not None]
                        if not findings:
                            return
                        await localize_findings_on_page(p, findings, self.store, self.vision)
                        p.updated_at = _now()
                        self.store.save_paper(p)
                    for f in findings:
                        bus.emit(paper_id, "localize.completed", {
                            "finding_id": f.finding_id,
                            "localize_status": f.localize_status.value,
                        })
                except Exception:
                    logger.exception("localize_all: page %d failed", page_number)

        await asyncio.gather(*(
            _one_page(page, [f.finding_id for f in fs])
            for page, fs in by_page.items()
        ))

        # Signal fan-out done.
        bus.emit(paper_id, "pipeline.done", {"status": "ready", "phase": "localize"})

    # -- decide / investigate -------------------------------------------------

    async def decide_finding(
        self,
        paper_id: str,
        finding_id: str,
        decision: FindingDecision,
        note: Optional[str],
    ) -> Optional[Finding]:
        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None
            f = paper.finding(finding_id)
            if not f:
                return None
            f.decision = decision
            f.decision_note = (note or None)
            paper.updated_at = _now()
            self.store.save_paper(paper)
            return f

    async def verify_finding(
        self,
        paper_id: str,
        finding_id: str,
    ) -> Optional[Finding]:
        """Tier-4 on-demand vision presence check for a single finding.

        Does not change bbox. Flips visually_verified and location_confidence
        based on vision's yes/no answer on the finding's current candidate page.
        """
        from app.pipeline.steps.localize import _render_page_png, VISION_PRESENCE_MIN_CONFIDENCE

        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        f = paper.finding(finding_id)
        if not f:
            return None
        page = f.page or (f.bbox.page if f.bbox else None)
        if not page:
            return None
        pdf_bytes = self.store.load_pdf(paper_id)
        if not pdf_bytes:
            return None
        try:
            page_png, _, _ = _render_page_png(pdf_bytes, page)
        except Exception:
            logger.exception("verify_finding: could not render page %d", page)
            return None
        try:
            result = await self.vision.verify_quote_on_page(page_png, f.evidence_quote)
        except Exception:
            logger.exception("verify_finding: vision call failed")
            return None

        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None
            f = paper.finding(finding_id)
            if not f:
                return None
            present = bool(result.get("present"))
            conf = int(result.get("confidence", 0))
            if conf >= VISION_PRESENCE_MIN_CONFIDENCE:
                if present:
                    f.visually_verified = True
                    f.location_confidence = max(f.location_confidence or 0, 90)
                    if f.bbox_source in (None, "page_map_single", "page_map_union"):
                        f.bbox_source = "vision_verified"
                    if f.localize_status == LocalizeStatus.approximate:
                        f.localize_status = LocalizeStatus.done
                else:
                    f.visually_verified = False
                    f.localize_status = LocalizeStatus.not_located
                    f.bbox = None
                    f.bbox_source = "missing"
                    f.location_confidence = 0
            paper.updated_at = _now()
            self.store.save_paper(paper)
            return f

    async def place_finding(
        self,
        paper_id: str,
        finding_id: str,
        page: int,
        bbox: BoundingBox,
    ) -> Optional[Finding]:
        """Manual bbox placement. Overrides any auto-localize result."""
        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None
            f = paper.finding(finding_id)
            if not f:
                return None
            f.bbox = BoundingBox(
                page=page,
                x=float(bbox.x),
                y=float(bbox.y),
                width=float(bbox.width),
                height=float(bbox.height),
            )
            f.page = page
            f.localize_status = LocalizeStatus.user_placed
            f.bbox_source = "user_placed"
            f.location_confidence = 100
            f.visually_verified = False
            f.soft_deleted = False
            f.parse_version = paper.parse_version
            paper.updated_at = _now()
            self.store.save_paper(paper)
            bus.emit(paper_id, "localize.completed", {
                "finding_id": f.finding_id,
                "localize_status": f.localize_status.value,
            })
            return f

    async def investigate_finding(
        self,
        paper_id: str,
        finding_id: str,
        user_message: str,
    ) -> Optional[Finding]:
        user_message = (user_message or "").strip()
        if not user_message:
            return None
        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None
            f = paper.finding(finding_id)
            if not f:
                return None
            block = _find_block(paper, f.proof_block_id)

            # Append + persist the user turn before releasing the lock, so we
            # don't lose it when we reload after the LLM call.
            f.exchanges.append(Exchange(role=ExchangeRole.user, content=user_message))
            paper.updated_at = _now()
            self.store.save_paper(paper)

        # Call LLM outside the lock — it may take seconds.
        assistant_text = await _investigate_llm(self.llm, paper, f, block)

        async with self._lock(paper_id):
            # Reload to avoid clobbering concurrent mutations.
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None
            f = paper.finding(finding_id)
            if not f:
                return None
            f.exchanges.append(Exchange(role=ExchangeRole.assistant, content=assistant_text))
            paper.updated_at = _now()
            self.store.save_paper(paper)
            return f

    # -- review draft ---------------------------------------------------------

    async def generate_review(
        self,
        paper_id: str,
        config: Optional[Dict] = None,
    ) -> Optional[ReviewDraft]:
        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None

        markdown = await _generate_review_llm(self.llm, paper, config or {})

        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None
            draft = ReviewDraft(markdown=markdown)
            paper.review_drafts.append(draft)
            paper.updated_at = _now()
            self.store.save_paper(paper)
            return draft

    async def finalize_review(
        self,
        paper_id: str,
        config: Optional[Dict] = None,
    ) -> Optional[tuple[float, str]]:
        """v2 — freeze the aggregate score from current decisions, then
        generate a draft using the persisted style snapshot. Returns
        `(aggregate, draft_id)` or `None` on 404.

        Score formula mirrors §3.3 of the v2 plan exactly: each agreed
        finding penalizes its dimension's score by severity weight, each
        dismissed finding earns a small false-alarm credit. Idempotent:
        if `final_score` already exists, we still generate a fresh draft
        but keep the original frozen aggregate (so the radar doesn't shift
        if the user re-runs Generate after the freeze).
        """
        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None
            if paper.final_score is None:
                # Re-derive the base then apply §3.3 decision deltas. We
                # don't trust the persisted dimension_scores here — they
                # may have been computed under an older formula. Re-deriving
                # keeps freeze identical to whatever the live /scores
                # endpoint and the frontend's client-side preview show.
                from app.routes.papers import _adjust_scores  # local import: avoids cycle at module load
                base = self._compute_base_scores(paper)
                adjusted = _adjust_scores(base, paper.findings)
                aggregate = (
                    round(sum(d.score for d in adjusted) / len(adjusted), 2)
                    if adjusted else 0.0
                )
                paper.dimension_scores = adjusted
                paper.final_score = aggregate
                paper.updated_at = _now()
                self.store.save_paper(paper)
            else:
                aggregate = paper.final_score

        # Generate the draft using the persisted style snapshot if available
        # (so finalize honors what the user picked at upload time).
        merged: Dict = {}
        if paper.review_style:
            merged = {
                k: v
                for k, v in paper.review_style.model_dump(mode="python").items()
                if v is not None
            }
        if config:
            merged.update({k: v for k, v in config.items() if v is not None})

        draft = await self.generate_review(paper_id, merged)
        if draft is None:
            return None
        return aggregate, draft.draft_id

    def get_review(self, paper_id: str, draft_id: str) -> Optional[ReviewDraft]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        return paper.draft(draft_id)

    def list_reviews(self, paper_id: str) -> Optional[List[ReviewDraft]]:
        """Return drafts newest-first, or None if the paper does not exist."""
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        return sorted(paper.review_drafts, key=lambda d: d.updated_at, reverse=True)

    async def patch_review(
        self, paper_id: str, draft_id: str, markdown: str,
    ) -> Optional[ReviewDraft]:
        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None
            draft = paper.draft(draft_id)
            if not draft:
                return None
            draft.markdown = markdown
            draft.updated_at = _now()
            paper.updated_at = _now()
            self.store.save_paper(paper)
            return draft


def _find_block(paper: Paper, proof_block_id: str) -> Optional[ProofBlock]:
    for b in paper.proof_blocks:
        if b.proof_block_id == proof_block_id:
            return b
    return None


def _estimate_remaining(paper: Paper) -> float:
    from app.models import SegmentClassification
    per_page = {
        SegmentClassification.proof: 0.04,
        SegmentClassification.theorem: 0.03,
        SegmentClassification.background: 0.01,
        SegmentClassification.experiment: 0.01,
        SegmentClassification.figures: 0.0,
        SegmentClassification.other: 0.01,
    }
    total = 0.0
    for s in paper.segments:
        if s.status in (SegmentStatus.done, SegmentStatus.skipped, SegmentStatus.failed, SegmentStatus.stopped):
            continue
        if s.priority <= 0:
            continue
        pages = s.page_end - s.page_start + 1
        total += pages * per_page.get(s.classification, 0.01)
    return total


_INVESTIGATE_SYSTEM = """You are helping a domain-expert reviewer dig deeper into a specific finding we flagged in a paper's proof. Respond conversationally, concisely, and with rigor. You may re-derive steps, propose counterexamples, check alternative formulations, or concede that the original finding was wrong if the user's argument is persuasive.

CRITICAL CONTEXT: The FULL parsed paper (main body + appendix + references) is attached as the first text block of the first user turn. Treat it as authoritative. When the user asks about any section, theorem, or appendix, you MUST search that attached text and answer from it — do not claim you lack access. Only say a passage is missing if you searched the attached text and it genuinely isn't present, and in that case name the missing thing concretely (e.g. "no 'Appendix H' header in the parsed markdown — MinerU may have dropped it").

If an earlier assistant turn in this thread claimed it couldn't see the appendix, that was wrong — ignore it. You have the paper now; answer from it.

Rules:
  - Use LaTeX math in $...$ or $$...$$ as needed. Preserve the paper's notation.
  - Keep responses to a few short paragraphs unless a longer derivation is required.
  - Do not invent citations. If the user asks about external references, say so.
  - If after exchange you believe the finding is actually correct-as-stated (i.e. our initial flag was wrong), say so explicitly."""


async def _investigate_llm(llm: LLMClient, paper: Paper, f: Finding, block: Optional[ProofBlock]) -> str:
    block_text = ""
    if block:
        parts = []
        if block.label:
            parts.append(f"[{block.label}]")
        if block.statement:
            parts.append(f"Statement:\n{block.statement}")
        if block.body:
            parts.append(f"Body / Proof:\n{block.body}")
        block_text = "\n\n".join(parts)

    transcript = []
    for ex in f.exchanges:
        transcript.append({"role": "user" if ex.role == ExchangeRole.user else "assistant", "content": ex.content})
    if not transcript:
        return ""

    # Give the assistant the whole parsed paper (incl. appendix) so "check
    # section 4" or "does the appendix fill this gap?" questions can be
    # answered from the source, not guessed. The paper body goes in a
    # cache_control block so repeat follow-ups on the same paper don't pay
    # full input-token price.
    paper_body = paper.markdown.strip() or "(paper text unavailable)"
    finding_context = (
        f"Finding under discussion:\n"
        f"  issue_type: {f.issue_type.value}\n"
        f"  severity: {f.severity.value}\n"
        f"  description: {f.description}\n"
        f"  evidence_quote: {f.evidence_quote}\n\n"
        f"Source proof block (page {f.page}):\n{block_text or '[not found]'}"
    )
    first_user_msg = transcript[0]["content"]
    transcript[0] = {
        "role": "user",
        "content": [
            {
                "type": "text",
                "text": (
                    "FULL PAPER TEXT (parsed, treat as ground truth for any "
                    "section/appendix the user asks you to check):\n\n"
                    f"{paper_body}"
                ),
                "cache_control": {"type": "ephemeral"},
            },
            {
                "type": "text",
                "text": (
                    f"{finding_context}\n\n---\n\nUser question:\n{first_user_msg}"
                ),
            },
        ],
    }

    return await llm.complete(
        model=settings.text_model,
        messages=transcript,
        system=_INVESTIGATE_SYSTEM,
        temperature=0.2,
        max_tokens=1500,
        tag="investigate",
    )


_STYLE_GUIDANCE = {
    "rigorous_skeptical": (
        "Voice: a careful, skeptical domain expert. Push back on weak arguments, flag unstated "
        "assumptions, and demand rigor. Concede only when evidence warrants it."
    ),
    "constructive_mentoring": (
        "Voice: a senior, constructive reviewer. Frame weaknesses as opportunities for revision; "
        "offer concrete suggestions; maintain a collegial, mentoring register."
    ),
    "terse_expert": (
        "Voice: a terse, expert reviewer. No filler, no pleasantries; bullet dense technical points."
    ),
}

_TONE_GUIDANCE = {
    "formal": "Tone: formal journal-review register. Third person, no contractions.",
    "neutral": "Tone: neutral and professional. First-person 'I' is acceptable but sparingly.",
    "casual": "Tone: direct and conversational, but still substantive.",
}

_LENGTH_GUIDANCE = {
    "short": "Target length: ~300 words. Be very compact.",
    "standard": "Target length: ~600 words. Dense, rigorous, no filler.",
    "thorough": "Target length: ~1200 words. Go deeper on detailed comments; still no filler.",
}

_SECTION_SPECS = {
    "summary": "## Summary — 2-4 sentences describing the paper's contribution and approach.",
    "strengths": "## Strengths — bullet or prose list of what the paper does well.",
    "weaknesses": "## Weaknesses — substantive concerns grounded in the AGREED findings.",
    "detailed": "## Detailed comments — numbered list tied one-to-one to AGREED findings.",
    "questions": "## Questions to the authors — unresolved points requiring author clarification.",
    "minor": "## Minor points — low-severity items, typos, stylistic suggestions.",
}

_DEFAULT_SECTIONS = ["summary", "strengths", "weaknesses", "detailed", "questions", "minor"]


def _build_review_system(config: Dict) -> str:
    field = (config.get("field") or "").strip()
    style = (config.get("style") or "rigorous_skeptical").strip()
    tone = (config.get("tone") or "formal").strip()
    length = (config.get("length") or "standard").strip()
    sections_in = config.get("sections") or _DEFAULT_SECTIONS
    sections = [s for s in sections_in if s in _SECTION_SPECS] or _DEFAULT_SECTIONS

    parts: List[str] = [
        "You are drafting a referee-style review of an academic paper based on our findings and the reviewer's decisions. Write in clear, professional prose suitable for a journal or conference review.",
    ]
    if field:
        parts.append(f"Field: this paper is in {field}. Calibrate terminology and expectations accordingly.")
    parts.append(_STYLE_GUIDANCE.get(style, _STYLE_GUIDANCE["rigorous_skeptical"]))
    parts.append(_TONE_GUIDANCE.get(tone, _TONE_GUIDANCE["formal"]))
    parts.append(_LENGTH_GUIDANCE.get(length, _LENGTH_GUIDANCE["standard"]))

    parts.append(
        "Structure the output as markdown with ONLY these sections, in this order:\n"
        + "\n".join(f"  {_SECTION_SPECS[k]}" for k in sections)
    )

    parts.append(
        "Rules:\n"
        "  - Only include findings the reviewer AGREED with as substantive weaknesses / detailed comments.\n"
        "  - Include DISMISSED findings only briefly in a final short paragraph explaining what was considered and ruled out.\n"
        "  - Include UNDECIDED (no decision) findings only if no decided findings exist; otherwise omit.\n"
        "  - Use the paper title and preserve its notation.\n"
        "  - No filler, no generic praise."
    )
    return "\n\n".join(parts)


async def _generate_review_llm(llm: LLMClient, paper: Paper, config: Dict) -> str:
    active = [f for f in paper.findings if not f.soft_deleted]
    by_decision = {"agree": [], "dismiss": [], None: []}
    for f in active:
        by_decision.setdefault(f.decision.value if f.decision else None, []).append(f)

    def _render(fs):
        lines = []
        for f in fs:
            lines.append(
                f"- [{f.issue_type.value}, severity={f.severity.value}, page {f.page}]"
                f" {f.description}"
                f"\n  evidence: \"{f.evidence_quote}\""
            )
            if f.decision_note:
                lines.append(f"  reviewer note: {f.decision_note}")
        return "\n".join(lines) or "(none)"

    prompt = (
        f"Paper title: {paper.title or paper.filename}\n\n"
        f"AGREED findings ({len(by_decision['agree'])}):\n{_render(by_decision['agree'])}\n\n"
        f"DISMISSED findings ({len(by_decision['dismiss'])}):\n{_render(by_decision['dismiss'])}\n\n"
        f"UNDECIDED findings ({len(by_decision[None])}):\n{_render(by_decision[None])}\n\n"
        f"Draft the review."
    )
    # Thorough length gets a larger cap; others stay at the prototype default.
    max_tokens = 4000 if (config.get("length") == "thorough") else 2500
    return await llm.complete(
        model=settings.text_model,
        messages=[{"role": "user", "content": prompt}],
        system=_build_review_system(config),
        temperature=0.3,
        max_tokens=max_tokens,
        tag="review",
    )


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
