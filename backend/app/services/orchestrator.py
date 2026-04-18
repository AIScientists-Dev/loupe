"""Thin coordination layer: paper CRUD + pipeline dispatch + localize + decide/investigate."""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from app.config import settings
from app.models import (
    Exchange,
    ExchangeRole,
    Finding,
    FindingDecision,
    LocalizeStatus,
    Paper,
    PaperStatus,
    PaperSummary,
    PipelineStep,
    ProofBlock,
    ReviewDraft,
    RunState,
    SegmentStatus,
)
from app.pipeline.runner import run_full_pipeline
from app.pipeline.steps.localize import localize_findings_on_page
from app.services.events import bus
from app.services.llm_client import LLMClient
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
    ) -> None:
        self.store = store
        self.llm = llm
        self.mineru = mineru
        self.vision = vision
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

    def create_paper(self, filename: str, pdf_bytes: bytes) -> Paper:
        paper = Paper(
            filename=filename,
            status=PaperStatus.analyzing,
            step=PipelineStep.parse,
            step_index=0,
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

    # -- pipeline dispatch ----------------------------------------------------

    async def run_pipeline_task(self, paper_id: str) -> None:
        """Entry point for the background task kicked from POST /v1/papers
        and POST /v1/papers/{id}/resume."""
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
        asyncio.create_task(self.run_pipeline_task(paper_id))
        return paper

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
        by_stage: dict = {}
        # NOTE: per-tag tokens come from the ephemeral usage_tracker
        # (process-wide). For per-paper breakdown we'd need a per-paper
        # tracker; this aggregate is fine for the prototype.
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
            if f.localize_status == LocalizeStatus.pending and not f.soft_deleted:
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

    async def generate_review(self, paper_id: str) -> Optional[ReviewDraft]:
        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None

        markdown = await _generate_review_llm(self.llm, paper)

        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None
            draft = ReviewDraft(markdown=markdown)
            paper.review_drafts.append(draft)
            paper.updated_at = _now()
            self.store.save_paper(paper)
            return draft

    def get_review(self, paper_id: str, draft_id: str) -> Optional[ReviewDraft]:
        paper = self.store.load_paper(paper_id)
        if not paper:
            return None
        return paper.draft(draft_id)

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


_INVESTIGATE_SYSTEM = """You are helping a domain-expert reviewer dig deeper into a specific finding we flagged in a paper's proof. Respond conversationally, concisely, and with rigor. You may re-derive steps, propose counterexamples, check alternative formulations, or concede that the original finding was wrong if the user's argument is persuasive.

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

    finding_context = (
        f"Finding details:\n"
        f"  issue_type: {f.issue_type.value}\n"
        f"  severity: {f.severity.value}\n"
        f"  description: {f.description}\n"
        f"  evidence_quote: {f.evidence_quote}\n\n"
        f"Source proof block (page {f.page}):\n{block_text or '[not found]'}"
    )
    # Prepend context into the first user message so the assistant sees it.
    transcript[0] = {
        "role": "user",
        "content": f"{finding_context}\n\n---\n\nUser question:\n{transcript[0]['content']}",
    }

    return await llm.complete(
        model=settings.text_model,
        messages=transcript,
        system=_INVESTIGATE_SYSTEM,
        temperature=0.2,
        max_tokens=1500,
        tag="investigate",
    )


_REVIEW_SYSTEM = """You are drafting a referee-style review of an academic paper based on our findings and the reviewer's decisions. Write in clear, professional prose suitable for a journal or conference review.

Structure the output as markdown with these sections:
  ## Summary
  ## Strengths
  ## Weaknesses
  ## Detailed comments (numbered list tied to findings the reviewer AGREED with)
  ## Questions to the authors
  ## Minor points (anything low-severity)

Rules:
  - Only include findings the reviewer AGREED with as substantive weaknesses / detailed comments.
  - Include DISMISSED findings only briefly in a final paragraph explaining what was considered and ruled out (for the reviewer's transparency).
  - Include UNDECIDED (no decision) findings only if no decided findings exist; otherwise omit.
  - Use the paper title and preserve its notation.
  - Keep under ~800 words. Dense, rigorous, no filler."""


async def _generate_review_llm(llm: LLMClient, paper: Paper) -> str:
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
    return await llm.complete(
        model=settings.text_model,
        messages=[{"role": "user", "content": prompt}],
        system=_REVIEW_SYSTEM,
        temperature=0.3,
        max_tokens=2500,
        tag="review",
    )


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
