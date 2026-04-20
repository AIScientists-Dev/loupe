"""Segment-based pipeline runner.

Lifecycle for a paper:

  1. planning_phase        — PyMuPDF outline → segment plan (one Sonnet call).
                             Sets paper.segments and paper.pricing_snapshot.
  2. run_segments_phase    — sequential, priority-ordered. Per segment:
        parse → extract_proofs → verify_proofs → localize
     After each, state is checkpointed and SSE events emitted.
  3. Honors a per-paper asyncio.Event so the user can hit Stop.

The scheduler never starts a segment after a stop signal has been set.
MinerU calls, once in flight, are not cancelled — they complete, then the
scheduler breaks.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx

from app.models import (
    LocalizeStatus,
    PageMapEntry,
    Paper,
    PaperStatus,
    PipelineStep,
    RunState,
    Segment,
    SegmentClassification,
    SegmentStatus,
)
from app.pipeline.steps.build_digest import build_digest
from app.pipeline.steps.extract_proofs import extract_proofs_from_markdown
from app.pipeline.steps.localize import localize_findings_on_page
from app.pipeline.steps.outline import extract_outline
from app.pipeline.steps.parse import extract_title_from, parse_page_range
from app.pipeline.steps.plan_segments import plan_segments
from app.pipeline.steps.verify_proofs import verify_blocks_batched
from app.config import settings
from app.services.events import bus
from app.services.llm_client import LLMClient, usage_tracker
from app.services.mineru_client import MinerUClient
from app.services.pricing import bill_user, gpu_cost, pricing_snapshot
from app.services.storage import FileStore
from app.services.vision_client import VisionClient

logger = logging.getLogger(__name__)

# Classifications that get proof extraction + verification. Others are
# parsed only so pages are visible, but skipped for proof analysis.
_PROOF_CLASSIFICATIONS = {
    SegmentClassification.proof,
    SegmentClassification.theorem,
}

# Paper IDs for which the NEXT budget check in run_segments should be
# skipped. Populated by enable_budget_bypass() when the user resumes a
# paper that was paused by the cap. One-shot — cleared after a single
# loop iteration lets the next segment through.
_budget_bypass: set[str] = set()


def enable_budget_bypass(paper_id: str) -> None:
    """Allow the given paper's next segment to run even if billed cost is
    already over settings.max_budget_usd. Called from the resume route
    when the user explicitly chooses to continue past the cap."""
    _budget_bypass.add(paper_id)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _save_merging_other_segments(store: FileStore, in_mem: Paper) -> None:
    """Persist `in_mem` without clobbering OTHER segments' mutations.

    The runner and route handlers can both write to the same Paper. The
    runner owns only: the current segment's fields, aggregate markdown +
    page_map, proof_blocks, findings, run_state, updated_at. Other
    segments might have been mutated by concurrent skip/include requests,
    so we reload from disk and only overwrite the fields the runner owns.
    """
    disk = store.load_paper(in_mem.paper_id)
    if disk is None:
        store.save_paper(in_mem)
        return

    # Aggregate content the runner grows:
    disk.markdown = in_mem.markdown
    disk.page_map = in_mem.page_map
    disk.proof_blocks = in_mem.proof_blocks
    disk.findings = in_mem.findings
    disk.run_state = in_mem.run_state
    disk.status = in_mem.status
    disk.step = in_mem.step
    disk.step_index = in_mem.step_index
    disk.title = in_mem.title or disk.title
    disk.page_count = in_mem.page_count or disk.page_count
    disk.updated_at = in_mem.updated_at
    disk.pricing_snapshot = in_mem.pricing_snapshot or disk.pricing_snapshot
    disk.stable_digest = in_mem.stable_digest or disk.stable_digest

    # Segment-list merge:
    #   - If disk has fewer segments than in_mem (e.g. runner just planned),
    #     the runner is authoritative — use its list wholesale.
    #   - Otherwise, walk disk's segments and adopt the runner's versions
    #     unless disk has been flipped to skipped/included by a concurrent
    #     route call while the runner still thinks the segment is pending.
    if len(in_mem.segments) > len(disk.segments):
        disk.segments = list(in_mem.segments)
    else:
        by_id = {s.segment_id: s for s in in_mem.segments}
        for i, s_disk in enumerate(disk.segments):
            s_mem = by_id.get(s_disk.segment_id)
            if s_mem is None:
                continue
            if (
                s_disk.status == SegmentStatus.skipped
                and s_mem.status == SegmentStatus.pending
            ):
                continue
            disk.segments[i] = s_mem

    store.save_paper(disk)


# ============================================================================
# Phase 1 — planning
# ============================================================================

async def run_planning(paper: Paper, store: FileStore, llm: LLMClient) -> None:
    """PyMuPDF outline → Sonnet segment plan. Cheap, fast, deterministic."""
    pdf_bytes = store.load_pdf(paper.paper_id)
    if not pdf_bytes:
        raise FileNotFoundError(f"PDF missing for paper {paper.paper_id}")

    paper.run_state = RunState.planning
    paper.pricing_snapshot = pricing_snapshot()
    _save_merging_other_segments(store, paper)
    bus.emit(paper.paper_id, "planning.started", {})

    headings, page_count = extract_outline(pdf_bytes)
    paper.page_count = page_count

    before = usage_tracker.cost_usd
    segments = await plan_segments(headings, page_count, llm)
    plan_cost = usage_tracker.cost_usd - before

    for seg in segments:
        if seg.priority <= 0:
            seg.status = SegmentStatus.skipped

    paper.segments = segments
    # Build the stable context digest up front so verify_proofs can use it
    # as the cacheable prompt block (saves ~70% of LLM cost on long papers).
    paper.stable_digest = build_digest(paper, pdf_bytes)
    paper.run_state = RunState.running
    paper.updated_at = _now()
    _save_merging_other_segments(store, paper)

    bus.emit(paper.paper_id, "outline.ready", {
        "page_count": page_count,
        "segments": [s.model_dump(mode="json") for s in segments],
        "plan_cost_raw_usd": round(plan_cost, 6),
        "estimate_total_raw_usd": _estimate_total_raw(paper),
    })


# ============================================================================
# Phase 2 — run segments in priority order
# ============================================================================

async def run_segments(
    paper: Paper,
    store: FileStore,
    llm: LLMClient,
    mineru: MinerUClient,
    vision: VisionClient,
    stop_event: asyncio.Event,
) -> None:
    """Main segment loop with one-segment MinerU look-ahead.

    Pipelining: while the current segment runs extract + verify + localize
    on the LLM, we pre-parse the next pending segment's MinerU call in the
    background. When this segment's LLM work finishes, the next segment's
    parse is already done (or nearly done) — cutting ~30% off total wall
    clock with zero cost and zero quality change.

    `prefetched` maps segment_id -> a Task that resolves to the MinerUParseResult
    tuple (markdown, page_map, elapsed_seconds).
    """
    paper_id = paper.paper_id
    prefetched: dict[str, asyncio.Task] = {}

    while True:
        # Reload between iterations so concurrent route mutations (skip /
        # include) are honored without clobbering work just saved.
        paper = store.load_paper(paper_id) or paper
        if stop_event.is_set():
            _cancel_prefetches(prefetched)
            _mark_stopped(paper, store)
            return
        seg = _next_pending(paper)
        if seg is None:
            break

        # Budget cap guardrail — pause before starting the next segment
        # if the running billed cost has already crossed the cap. Resume
        # bypasses this check once so the user can opt to continue.
        if settings.max_budget_usd > 0 and paper_id not in _budget_bypass:
            running_billed = bill_user(paper.total_cost_raw())
            if running_billed >= settings.max_budget_usd:
                logger.info(
                    "budget cap reached for %s: billed=$%.4f cap=$%.2f",
                    paper_id, running_billed, settings.max_budget_usd,
                )
                _cancel_prefetches(prefetched)
                paper.run_state = RunState.paused
                paper.updated_at = _now()
                _save_merging_other_segments(store, paper)
                bus.emit(paper_id, "run.budget_exceeded", {
                    "running_billed_usd": running_billed,
                    "cap_billed_usd": settings.max_budget_usd,
                    "segments_remaining": sum(
                        1 for s in paper.segments
                        if s.status == SegmentStatus.pending and s.priority > 0
                    ),
                })
                return
        _budget_bypass.discard(paper_id)

        # Use any speculative parse we kicked off in the previous iteration,
        # otherwise start one now for the current segment.
        parse_task = prefetched.pop(seg.segment_id, None)
        if parse_task is None:
            parse_task = asyncio.create_task(
                _parse_only(paper, seg, store, mineru),
                name=f"parse-{seg.segment_id[:8]}",
            )

        # Kick off look-ahead parse for the NEXT pending segment NOW, before
        # awaiting this segment's work. That is the pipelining: while
        # _process_segment waits for parse_task + then runs extract / verify
        # / localize on the LLM, the next segment's MinerU call is already
        # running in the background.
        next_seg = _peek_next_pending(paper, exclude={seg.segment_id})
        if next_seg and next_seg.segment_id not in prefetched:
            prefetched[next_seg.segment_id] = asyncio.create_task(
                _parse_only(paper, next_seg, store, mineru),
                name=f"prefetch-{next_seg.segment_id[:8]}",
            )
            logger.info(
                "prefetching MinerU for next segment p%d-%d (runs in parallel with current seg's LLM)",
                next_seg.page_start, next_seg.page_end,
            )

        try:
            await _process_segment(paper, seg, store, llm, mineru, vision, parse_task)
        except Exception as exc:
            logger.exception("segment %s failed: %s", seg.segment_id, exc)
            seg.status = SegmentStatus.failed
            seg.finished_at = _now()
            paper.updated_at = _now()
            _save_merging_other_segments(store, paper)
            bus.emit(paper_id, "segment.failed", {
                "segment_id": seg.segment_id,
                "error_code": _classify_error(exc),
                "message": str(exc),
                "retriable": _is_retriable(exc),
            })
        _emit_cost_updated(paper)

    # Drain any leftover prefetches (user may have skipped everything after).
    _cancel_prefetches(prefetched)

    paper = store.load_paper(paper_id) or paper
    if stop_event.is_set():
        _mark_stopped(paper, store)
        return

    paper.run_state = RunState.completed
    paper.status = PaperStatus.ready
    paper.step = PipelineStep.ready
    paper.step_index = 3
    paper.updated_at = _now()
    _save_merging_other_segments(store, paper)
    bus.emit(paper_id, "run.completed", {
        "total_raw_usd": round(paper.total_cost_raw(), 4),
        "total_billed_usd": bill_user(paper.total_cost_raw()),
    })


async def _process_segment(
    paper: Paper,
    seg: Segment,
    store: FileStore,
    llm: LLMClient,
    mineru: MinerUClient,
    vision: VisionClient,
    parse_task: Optional[asyncio.Task] = None,
) -> None:
    """Process one segment end-to-end.

    If `parse_task` is supplied, we use that already-running (or already-
    completed) MinerU Task instead of starting a fresh one. This is how
    the look-ahead pipelining saves wall clock — the parse overlapped with
    the previous segment's LLM work.
    """
    seg.started_at = _now()
    seg.status = SegmentStatus.parsing
    paper.updated_at = _now()
    _save_merging_other_segments(store, paper)
    page_span = seg.page_end - seg.page_start + 1
    # Empirical rate on g6.xlarge from the fixture: ~34s/page. Frontend uses
    # this to interpolate a page-level playhead during parse (MinerU doesn't
    # expose mid-request progress).
    seconds_per_page_estimate = 34.0
    bus.emit(paper.paper_id, "segment.started", {
        "segment_id": seg.segment_id,
        "label": seg.label,
        "page_start": seg.page_start,
        "page_end": seg.page_end,
        "classification": seg.classification.value,
        "priority": seg.priority,
        "mineru_eta_seconds": round(page_span * seconds_per_page_estimate, 1),
        "mineru_seconds_per_page_estimate": seconds_per_page_estimate,
        "prefetched": parse_task is not None,
    })

    if parse_task is not None:
        # If the look-ahead already finished, this `await` returns instantly.
        try:
            seg_md, seg_pm, elapsed = await parse_task
        except Exception:
            # Prefetch failed — fall back to a fresh parse so a flaky MinerU
            # round-trip doesn't sink the segment permanently.
            logger.exception("prefetched parse for %s failed; retrying fresh", seg.segment_id)
            parse_task = None

    if parse_task is None:
        pdf_bytes = store.load_pdf(paper.paper_id)
        if not pdf_bytes:
            raise FileNotFoundError(f"PDF missing for paper {paper.paper_id}")
        seg_md, seg_pm, elapsed = await parse_page_range(
            pdf_bytes, paper.filename, mineru,
            page_start=seg.page_start, page_end=seg.page_end,
        )
    seg.gpu_seconds = elapsed
    seg.gpu_cost_usd = gpu_cost(elapsed)

    # Merge segment output into paper aggregates.
    offset = len(paper.markdown)
    separator = "\n\n" if paper.markdown else ""
    paper.markdown += separator + seg_md
    sep_len = len(separator)
    for entry in seg_pm:
        paper.page_map.append(PageMapEntry(
            page=entry.page,
            block_type=entry.block_type,
            char_start=entry.char_start + offset + sep_len,
            char_end=entry.char_end + offset + sep_len,
            bbox=entry.bbox,
            section=entry.section,
        ))
    # Bump parse_version so localize caches know the markdown/offsets shifted.
    paper.parse_version = uuid.uuid4().hex
    if not paper.title:
        paper.title = extract_title_from(paper.page_map, paper.markdown)

    paper.updated_at = _now()
    _save_merging_other_segments(store, paper)
    bus.emit(paper.paper_id, "segment.parsed", {
        "segment_id": seg.segment_id,
        "mineru_seconds": round(elapsed, 2),
        "gpu_cost_raw_usd": round(seg.gpu_cost_usd, 6),
    })

    if seg.classification not in _PROOF_CLASSIFICATIONS:
        seg.status = SegmentStatus.done
        seg.finished_at = _now()
        paper.updated_at = _now()
        _save_merging_other_segments(store, paper)
        bus.emit(paper.paper_id, "segment.completed", {
            "segment_id": seg.segment_id,
            "cost_subtotal_raw_usd": seg.cost_subtotal_usd(),
            "cost_subtotal_billed_usd": bill_user(seg.cost_subtotal_usd()),
            "finding_count": 0,
        })
        return

    # -- extract ---------------------------------------------------------
    seg.status = SegmentStatus.extracting
    _save_merging_other_segments(store, paper)

    cost_before = usage_tracker.cost_usd
    new_blocks = await extract_proofs_from_markdown(seg_md, seg_pm, llm)
    for b in new_blocks:
        b.char_start += offset + sep_len
        b.char_end += offset + sep_len
        paper.proof_blocks.append(b)
        seg.proof_block_ids.append(b.proof_block_id)
    seg.llm_cost_usd += usage_tracker.cost_usd - cost_before
    paper.updated_at = _now()
    _save_merging_other_segments(store, paper)
    bus.emit(paper.paper_id, "segment.extracted", {
        "segment_id": seg.segment_id,
        "proof_blocks_count": len(new_blocks),
    })

    # -- verify (batched: one LLM call for the whole segment) ----------
    seg.status = SegmentStatus.verifying
    _save_merging_other_segments(store, paper)
    if new_blocks:
        cost_before = usage_tracker.cost_usd
        findings = await verify_blocks_batched(
            new_blocks,
            paper.stable_digest or paper.markdown,
            llm,
        )
        seg.llm_cost_usd += usage_tracker.cost_usd - cost_before
        for f in findings:
            paper.findings.append(f)
            seg.finding_ids.append(f.finding_id)
            bus.emit(paper.paper_id, "finding.created", {
                "segment_id": seg.segment_id,
                "finding": f.model_dump(mode="json"),
            })
    paper.updated_at = _now()
    _save_merging_other_segments(store, paper)

    # -- localize (batched per page) ------------------------------------
    seg.status = SegmentStatus.localizing
    _save_merging_other_segments(store, paper)

    findings_list = [paper.finding(fid) for fid in seg.finding_ids]
    pending = [
        f for f in findings_list
        if f is not None and f.localize_status == LocalizeStatus.pending and not f.soft_deleted
    ]
    by_page: dict = {}
    for f in pending:
        by_page.setdefault(f.page, []).append(f)
    for page_num, fs in sorted(by_page.items()):
        cost_before = usage_tracker.cost_usd
        await localize_findings_on_page(paper, fs, store, vision)
        seg.llm_cost_usd += usage_tracker.cost_usd - cost_before
        for f in fs:
            bus.emit(paper.paper_id, "localize.completed", {
                "segment_id": seg.segment_id,
                "finding_id": f.finding_id,
                "localize_status": f.localize_status.value,
                "bbox": f.bbox.model_dump(mode="json") if f.bbox else None,
            })

    seg.status = SegmentStatus.done
    seg.finished_at = _now()
    paper.updated_at = _now()
    _save_merging_other_segments(store, paper)
    bus.emit(paper.paper_id, "segment.completed", {
        "segment_id": seg.segment_id,
        "cost_subtotal_raw_usd": seg.cost_subtotal_usd(),
        "cost_subtotal_billed_usd": bill_user(seg.cost_subtotal_usd()),
        "finding_count": len(seg.finding_ids),
    })


# ============================================================================
# Helpers
# ============================================================================

def _next_pending(paper: Paper) -> Optional[Segment]:
    candidates = [
        s for s in paper.segments
        if s.status == SegmentStatus.pending and s.priority > 0
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda s: (-s.priority, s.page_start))
    return candidates[0]


def _peek_next_pending(paper: Paper, exclude: set[str]) -> Optional[Segment]:
    """Same as _next_pending but skips a set of segment_ids (typically the
    one currently being processed). Used for look-ahead prefetch."""
    candidates = [
        s for s in paper.segments
        if s.status == SegmentStatus.pending
        and s.priority > 0
        and s.segment_id not in exclude
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda s: (-s.priority, s.page_start))
    return candidates[0]


async def _parse_only(
    paper: Paper,
    seg: Segment,
    store: FileStore,
    mineru: MinerUClient,
):
    """Pure MinerU call returning (markdown, page_map, elapsed_seconds).
    No paper-state mutation, no SSE emit — meant to be kicked as a
    background Task and awaited later by _process_segment."""
    pdf_bytes = store.load_pdf(paper.paper_id)
    if not pdf_bytes:
        raise FileNotFoundError(f"PDF missing for paper {paper.paper_id}")
    return await parse_page_range(
        pdf_bytes, paper.filename, mineru,
        page_start=seg.page_start, page_end=seg.page_end,
    )


def _cancel_prefetches(prefetched: dict[str, asyncio.Task]) -> None:
    """Request cancellation of any still-running prefetch tasks. MinerU
    calls that are already in flight will complete server-side (we have
    no way to cancel the remote GPU work), but we release our handle so
    garbage collection cleans up."""
    for task in prefetched.values():
        if not task.done():
            task.cancel()
    prefetched.clear()


def _estimate_total_raw(paper: Paper) -> float:
    """Rough forward-looking estimate for UI — cheap heuristic."""
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
        if s.priority <= 0:
            continue
        pages = s.page_end - s.page_start + 1
        total += pages * per_page.get(s.classification, 0.01)
    return round(total, 4)


def _emit_cost_updated(paper: Paper) -> None:
    raw = paper.total_cost_raw()
    bus.emit(paper.paper_id, "cost.updated", {
        "running_raw_usd": round(raw, 4),
        "running_billed_usd": bill_user(raw),
    })


def _mark_stopped(paper: Paper, store: FileStore) -> None:
    paper.run_state = RunState.stopped
    paper.updated_at = _now()
    _save_merging_other_segments(store, paper)
    bus.emit(paper.paper_id, "run.stopped", {"reason": "user"})


def _classify_error(exc: BaseException) -> str:
    if isinstance(exc, FileNotFoundError):
        return "pdf_unreadable"
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code if exc.response is not None else 0
        if status == 429:
            return "llm_rate_limited"
        if 500 <= status < 600:
            return "mineru_unavailable" if "mineru" in str(exc).lower() else "llm_error"
        return "llm_error"
    if isinstance(exc, httpx.RequestError):
        return "mineru_unavailable"
    if isinstance(exc, ValueError):
        return "llm_invalid_response"
    return "internal"


def _is_retriable(exc: BaseException) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code if exc.response is not None else 0
        return status == 429 or 500 <= status < 600
    return isinstance(exc, httpx.RequestError)


# ============================================================================
# Entry point
# ============================================================================

async def run_full_pipeline(
    paper: Paper,
    store: FileStore,
    llm: LLMClient,
    mineru: MinerUClient,
    vision: VisionClient,
    stop_event: asyncio.Event,
) -> None:
    if paper.run_state in (RunState.idle, RunState.failed):
        await run_planning(paper, store, llm)
        paper = store.load_paper(paper.paper_id) or paper

    if paper.run_state == RunState.stopped:
        return

    paper.run_state = RunState.running
    _save_merging_other_segments(store, paper)
    bus.emit(paper.paper_id, "run.started", {})

    await run_segments(paper, store, llm, mineru, vision, stop_event)
