"""Segment planner — one Sonnet call that turns headings → segment plan.

Input:  list of OutlineHeading + total page count.
Output: list of Segment with contiguous page ranges + classification + priority.

The priority scale (0-10) drives the scheduler:
  10  proofs                             — always first
   8  theorem / main-result statements
   4  experiments / numerical results
   3  background, preliminaries, intro
   0  pure-figure appendices             — skipped entirely
"""
from __future__ import annotations

import logging
from typing import List

from app.config import settings
from app.models import (
    OutlineHeading,
    Segment,
    SegmentClassification,
    SegmentStatus,
)
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)


_SYSTEM = """You are segmenting an academic paper for cost-controlled analysis. Given the paper's heading outline + total page count, return a list of contiguous, non-overlapping page-range segments that together cover EVERY page from 1 to total_pages.

For EACH segment you emit, provide:
  - page_start (inclusive, 1-based)
  - page_end   (inclusive, 1-based; page_end >= page_start)
  - label      (concise, human-readable; what the user will see in the UI)
  - classification: one of
      "proof"       — formal proof text of theorems / lemmas / propositions (NOT statements alone)
      "theorem"     — statements of theorems / lemmas / main results (not their proofs)
      "background"  — intro, related work, preliminaries, notation, assumptions
      "experiment"  — experimental results, numerical simulations, tables of results
      "figures"     — appendix sections that are predominantly figures with minimal text
      "other"       — acknowledgements, references, author info, anything else
  - priority: integer
      10 → proof-heavy sections (highest value to scan)
       8 → theorem / main-result statements
       6 → a section that mixes theorems AND their proofs
       4 → experiments
       3 → background, preliminaries, intro, related work
       2 → conclusion, discussion (typically low-value for proof-checking)
       0 → pure-figures appendices, references-only pages (these will be SKIPPED)

Rules:
  - Segments must tile the paper: every page 1..total_pages is covered exactly once.
  - Prefer segments of 3–15 pages. Split large sections (>15 pages) at natural sub-heading boundaries.
  - Merge tiny adjacent headings (<3 pages each) of the same classification into one segment.
  - When a heading is ambiguous between classifications, use the higher-priority one (so we don't accidentally skip proofs).
  - If the paper has supplementary material that is clearly figures-only, classify it as "figures" and priority=0.

Return ONLY a JSON array. No markdown fences. No prose.

Example element:
  {"page_start": 19, "page_end": 33, "label": "Proofs (Section 4)", "classification": "proof", "priority": 10}"""


async def plan_segments(
    headings: List[OutlineHeading],
    total_pages: int,
    llm: LLMClient,
) -> List[Segment]:
    """One Sonnet call → list of Segment. Guaranteed to tile [1..total_pages]."""
    if total_pages < 1:
        return []

    # If no outline was detected at all, emit one single segment of unknown
    # classification (fall back to full-paper analysis).
    if not headings:
        logger.info("plan_segments: no headings — emitting single fallback segment")
        return [Segment(
            page_start=1, page_end=total_pages,
            label="Full paper", classification=SegmentClassification.other, priority=5,
        )]

    user = (
        f"Total pages: {total_pages}\n\n"
        f"Headings (one per line, format 'pN Ltype: TEXT'):\n"
        + "\n".join(f"p{h.page} L{h.level}: {h.text}" for h in headings)
        + "\n\nReturn the JSON segment array."
    )

    try:
        raw = await llm.complete_json(
            model=settings.text_model,
            messages=[{"role": "user", "content": user}],
            system=_SYSTEM,
            temperature=0.0,
            max_tokens=2048,
            tag="plan_segments",
        )
    except Exception:
        logger.exception("plan_segments: LLM call failed — falling back to whole-paper segment")
        return [Segment(
            page_start=1, page_end=total_pages,
            label="Full paper", classification=SegmentClassification.other, priority=5,
        )]

    if not isinstance(raw, list):
        logger.warning("plan_segments: expected array, got %s — falling back", type(raw).__name__)
        return [Segment(
            page_start=1, page_end=total_pages,
            label="Full paper", classification=SegmentClassification.other, priority=5,
        )]

    segments: List[Segment] = []
    for item in raw:
        seg = _coerce(item, total_pages)
        if seg is not None:
            segments.append(seg)
    segments = _normalize_tiling(segments, total_pages)
    logger.info("plan_segments: %d segments covering %d pages", len(segments), total_pages)
    return segments


def _coerce(item, total_pages: int):
    if not isinstance(item, dict):
        return None
    try:
        ps = int(item["page_start"])
        pe = int(item["page_end"])
        label = str(item.get("label") or "").strip()
        cls_raw = str(item.get("classification", "other")).lower().strip()
        priority = int(item.get("priority", 5))
    except (KeyError, TypeError, ValueError):
        return None
    if ps < 1 or pe < ps or pe > total_pages:
        return None
    try:
        cls = SegmentClassification(cls_raw)
    except ValueError:
        cls = SegmentClassification.other
    priority = max(0, min(10, priority))
    if not label:
        label = f"Pages {ps}-{pe}"
    return Segment(
        page_start=ps, page_end=pe, label=label,
        classification=cls, priority=priority,
    )


def _normalize_tiling(segments: List[Segment], total_pages: int) -> List[Segment]:
    """Ensure segments tile [1..total_pages] with no gaps or overlaps."""
    if not segments:
        return [Segment(
            page_start=1, page_end=total_pages,
            label="Full paper", classification=SegmentClassification.other, priority=5,
        )]

    segments = sorted(segments, key=lambda s: (s.page_start, s.page_end))

    # Merge overlaps by trimming; fill gaps with 'other' priority=2.
    out: List[Segment] = []
    cursor = 1
    for seg in segments:
        if seg.page_start > cursor:
            out.append(Segment(
                page_start=cursor, page_end=seg.page_start - 1,
                label=f"Pages {cursor}-{seg.page_start - 1}",
                classification=SegmentClassification.other, priority=2,
            ))
        if seg.page_end < cursor:
            continue  # fully covered already
        seg.page_start = max(seg.page_start, cursor)
        out.append(seg)
        cursor = seg.page_end + 1
    if cursor <= total_pages:
        out.append(Segment(
            page_start=cursor, page_end=total_pages,
            label=f"Pages {cursor}-{total_pages}",
            classification=SegmentClassification.other, priority=2,
        ))

    # Pure-figures segments are priority 0 regardless of what LLM said
    # (defensive — saves cost if the LLM mis-priorities).
    for seg in out:
        if seg.classification == SegmentClassification.figures and seg.priority > 0:
            seg.priority = 0
        if seg.status != SegmentStatus.pending and seg.priority == 0:
            seg.status = SegmentStatus.skipped
    return out
