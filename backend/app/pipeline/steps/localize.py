"""Localize step — deterministic-first.

Pipeline, per finding:

  1. Look up the parent proof block (for duplicate disambiguation).
  2. Find every occurrence of the evidence_quote in paper.markdown
     (tight match first; loose match only if tight returns none).
  3. Pick the occurrence closest to / inside the proof block's char range.
  4. Resolve the bbox from paper.page_map (union entries overlapping the
     quote's [char_start, char_end)). Primary page = majority-char page.
  5. If anchor_confidence is 'fuzzy' AND severity is high, run a single
     binary vision presence check to sanity-check the page choice.
     Vision NEVER picks coordinates.
  6. Emit a terminal localize_status:
       - done            → deterministic + (if triggered) vision confirmed
       - approximate     → deterministic landed but vision said it's not here
       - quote_unverified→ came in from Step 0 gate already
       - not_located     → no candidate at all
       - user_placed     → untouched by this pipeline

No soft-delete. Every finding stays visible.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from app.models import (
    BoundingBox,
    Finding,
    LocalizeStatus,
    Paper,
    ProofBlock,
    Severity,
)
from app.pipeline.text_anchor import (
    Occurrence,
    all_occurrences,
    bbox_for_range,
    classify_matches,
    page_for_offset,
)
from app.services.storage import FileStore
from app.services.vision_client import VisionClient

logger = logging.getLogger(__name__)


RENDER_DPI = 150  # used only for the optional presence-check vision call
VISION_PRESENCE_MIN_CONFIDENCE = 80  # vision must be this sure to reject a candidate


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

async def localize_findings_on_page(
    paper: Paper,
    findings: List[Finding],
    store: FileStore,
    vision: VisionClient,
) -> None:
    """Localize each finding deterministically. Per-finding; no page batching.

    This name is preserved because the orchestrator calls it; semantically
    it now processes the findings one at a time since the deterministic
    path doesn't benefit from page batching.
    """
    for f in findings:
        try:
            await localize_finding(paper, f, store, vision)
        except Exception:
            logger.exception("localize: finding %s failed", f.finding_id)


async def localize_finding(
    paper: Paper,
    finding: Finding,
    store: FileStore,
    vision: VisionClient,
) -> None:
    """Single-finding deterministic localize with an optional vision safety
    valve for high-severity fuzzy matches.

    Writes result fields directly to `finding`. Caller is responsible for
    persisting the paper.
    """
    # Short-circuits ------------------------------------------------------
    if finding.localize_status == LocalizeStatus.user_placed:
        return  # never touch a manually-placed bbox

    if finding.localize_status == LocalizeStatus.quote_unverified:
        # Upstream already decided the quote isn't in the markdown.
        finding.bbox = None
        finding.bbox_source = "missing"
        finding.location_confidence = 0
        finding.parse_version = paper.parse_version
        return

    # Cache check: if we've already localized against the current parse
    # version and nothing's changed, leave it alone.
    if (
        finding.parse_version == paper.parse_version
        and finding.localize_status in (LocalizeStatus.done, LocalizeStatus.approximate, LocalizeStatus.not_located)
    ):
        return

    # Step 1-2: deterministic anchor + bbox ------------------------------
    parent = _find_parent_block(paper, finding.proof_block_id)
    occurrences = all_occurrences(paper.markdown, finding.evidence_quote)
    report = classify_matches(
        occurrences,
        parent_char_start=parent.char_start if parent else None,
        parent_char_end=parent.char_end if parent else None,
    )
    ranked = report.best

    # Log the ambiguity category whenever there's more than one match. This
    # is the measurement the fixture run needs to settle strict-vs-loose.
    if len(occurrences) > 1:
        logger.info(
            "localize.ambiguity finding=%s category=%s inside=%d outside=%d",
            finding.finding_id, report.category,
            report.inside_count, report.outside_count,
        )

    if ranked is None:
        # No occurrence anywhere → not_located. Finding stays visible.
        finding.bbox = None
        finding.page = (parent.page_hint if parent else finding.page) or 1
        finding.bbox_source = "missing"
        finding.location_confidence = 0
        finding.anchor_confidence = "none"
        finding.localize_status = LocalizeStatus.not_located
        finding.parse_version = paper.parse_version
        logger.info(
            "localize: not_located (no occurrence in markdown) finding=%s",
            finding.finding_id,
        )
        return

    occ = ranked.occurrence
    char_start = occ.offset
    char_end = occ.offset + occ.length

    bbox_result = bbox_for_range(paper.page_map, char_start, char_end)
    if bbox_result is None:
        # We have the offset but no bbox in page_map. Fall back to the
        # parent block's bbox (paragraph-level) if available; otherwise
        # emit page-only "approximate".
        page = page_for_offset(paper.page_map, char_start) or (parent.page_hint if parent else 1)
        fallback_bbox = parent.bbox if parent else None
        finding.bbox = fallback_bbox
        finding.page = page
        finding.bbox_source = "page_map_union" if fallback_bbox else "missing"
        finding.location_confidence = 40 if fallback_bbox else 20
        finding.anchor_confidence = ranked.confidence
        finding.localize_status = LocalizeStatus.approximate if fallback_bbox else LocalizeStatus.not_located
        finding.parse_version = paper.parse_version
        logger.info(
            "localize: approximate fallback (no page_map bbox) finding=%s page=%d",
            finding.finding_id, page,
        )
        return

    primary_page, bbox = bbox_result
    finding.bbox = bbox
    finding.page = primary_page
    finding.anchor_confidence = ranked.confidence
    finding.parse_version = paper.parse_version

    # Determine bbox_source for UI rendering
    # (single vs union inferable from how many page_map entries overlapped).
    entries_overlapping = sum(
        1
        for e in paper.page_map
        if e.page == primary_page
        and e.bbox is not None
        and not (e.char_end <= char_start or e.char_start >= char_end)
    )
    finding.bbox_source = "page_map_union" if entries_overlapping > 1 else "page_map_single"

    # Tier-3 escalation decision (strict): run vision disambiguation only
    # when the parent-block constraint genuinely can't pick a winner —
    # multi_in_parent (several inside) or all_outside_parent (none inside).
    # single_in_parent defers to the deterministic pick (the inside match).
    should_escalate = report.category in ("multi_in_parent", "all_outside_parent")

    if should_escalate:
        try:
            resolved = await _vision_disambiguate(
                paper, finding, report, parent, store, vision,
            )
        except Exception:
            logger.exception("localize: tier-3 disambiguation failed for %s", finding.finding_id)
            resolved = None

        if resolved is not None:
            # Vision picked one of the candidate occurrences. Recompute bbox
            # from that offset and mark done + vision_verified.
            resolved_bbox = bbox_for_range(
                paper.page_map, resolved.offset, resolved.offset + resolved.length,
            )
            if resolved_bbox is not None:
                rp_page, rp_bbox = resolved_bbox
                finding.bbox = rp_bbox
                finding.page = rp_page
                finding.localize_status = LocalizeStatus.done
                finding.bbox_source = "vision_verified"
                finding.visually_verified = True
                finding.location_confidence = 90
                finding.anchor_confidence = ranked.confidence
                logger.info(
                    "localize: done (tier-3 disambiguated) finding=%s page=%d",
                    finding.finding_id, rp_page,
                )
                return
        # Vision inconclusive or rejected all candidates → fall through to
        # deterministic pick as `approximate`, so the finding stays visible.
        finding.localize_status = LocalizeStatus.approximate
        finding.location_confidence = 45
        finding.visually_verified = False
        logger.info(
            "localize: approximate (tier-3 inconclusive, %s) finding=%s page=%d",
            report.category, finding.finding_id, primary_page,
        )
        return

    # Non-ambiguous cases — deterministic answer wins.
    if ranked.confidence in ("exact_in_block", "exact_near_block"):
        finding.localize_status = LocalizeStatus.done
        finding.location_confidence = 90 if ranked.confidence == "exact_in_block" else 75
        finding.visually_verified = False
        logger.info(
            "localize: done (deterministic, %s) finding=%s page=%d",
            ranked.confidence, finding.finding_id, primary_page,
        )
        return

    # Fuzzy match with no ambiguity → approximate (stripe still renders).
    finding.localize_status = LocalizeStatus.approximate
    finding.location_confidence = 55 if ranked.confidence == "fuzzy_in_block" else 35
    finding.visually_verified = False
    logger.info(
        "localize: approximate (fuzzy, no-ambiguity) finding=%s page=%d conf=%s",
        finding.finding_id, primary_page, ranked.confidence,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_parent_block(paper: Paper, proof_block_id: str) -> Optional[ProofBlock]:
    for b in paper.proof_blocks:
        if b.proof_block_id == proof_block_id:
            return b
    return None


DISAMBIG_MIN_CONFIDENCE = 70
_DISAMBIG_CONTEXT_CHARS = 80   # ± chars of context surrounding each candidate
_MAX_DISAMBIG_CANDIDATES = 6   # cap input size


async def _vision_disambiguate(
    paper: Paper,
    finding: Finding,
    report,
    parent: Optional[ProofBlock],
    store: FileStore,
    vision: VisionClient,
) -> Optional[Occurrence]:
    """Tier-3: let vision pick the right occurrence out of the ambiguous set.

    Returns the chosen `Occurrence` if vision is confident; otherwise None.
    """
    # Build the candidate list: deterministic best first, then outside candidates.
    candidates: List[Occurrence] = []
    if report.best is not None:
        candidates.append(report.best.occurrence)
    for o in report.outside_candidates:
        if all(o.offset != c.offset for c in candidates):
            candidates.append(o)
    candidates = candidates[:_MAX_DISAMBIG_CANDIDATES]
    if len(candidates) < 2:
        return None

    # Each candidate must live on a single page (for the visual crop). We
    # disambiguate per-page when candidates span pages — for the first pass,
    # send the deterministic-best's page.
    primary_page = page_for_offset(paper.page_map, candidates[0].offset)
    if primary_page is None:
        return None

    # Render context snippets
    ctx_payloads: List[dict] = []
    for o in candidates:
        s = max(0, o.offset - _DISAMBIG_CONTEXT_CHARS)
        e = min(len(paper.markdown), o.offset + o.length + _DISAMBIG_CONTEXT_CHARS)
        snippet = paper.markdown[s:e].replace("\n", " ")
        ctx_payloads.append({"context": snippet})

    # Render the candidate page and ask vision to pick.
    pdf_bytes = store.load_pdf(paper.paper_id)
    if not pdf_bytes:
        return None
    try:
        page_png, _, _ = _render_page_png(pdf_bytes, primary_page)
    except Exception:
        logger.exception("localize: render failed for disambig page %d", primary_page)
        return None

    try:
        result = await vision.disambiguate_candidates(
            page_png, finding.evidence_quote, ctx_payloads,
        )
    except Exception:
        logger.exception("localize: vision disambig failed")
        return None

    picked = result.get("picked")
    conf = int(result.get("confidence", 0))
    if picked is None or conf < DISAMBIG_MIN_CONFIDENCE:
        logger.info(
            "localize: disambig inconclusive finding=%s picked=%s conf=%d",
            finding.finding_id, picked, conf,
        )
        return None
    logger.info(
        "localize: disambig picked candidate %d (conf=%d) finding=%s",
        picked, conf, finding.finding_id,
    )
    return candidates[picked]


async def _vision_presence_check(
    paper: Paper,
    finding: Finding,
    page_number: int,
    store: FileStore,
    vision: VisionClient,
) -> Optional[bool]:
    """Returns True if vision confirms the quote on the page, False if it
    confidently denies, None if inconclusive (low confidence / error).
    """
    pdf_bytes = store.load_pdf(paper.paper_id)
    if not pdf_bytes:
        logger.warning("localize: pdf missing for paper %s (vision presence skipped)", paper.paper_id)
        return None
    try:
        page_png, _, _ = _render_page_png(pdf_bytes, page_number)
    except Exception:
        logger.exception("localize: could not render page %d for presence check", page_number)
        return None

    result = await vision.verify_quote_on_page(page_png, finding.evidence_quote)
    conf = int(result.get("confidence", 0))
    present = bool(result.get("present"))
    if conf < VISION_PRESENCE_MIN_CONFIDENCE:
        return None
    return present


def _render_page_png(pdf_bytes: bytes, page_number_1based: int) -> tuple[bytes, float, float]:
    import fitz  # PyMuPDF
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        if page_number_1based < 1 or page_number_1based > doc.page_count:
            raise ValueError(f"page {page_number_1based} out of range (doc has {doc.page_count})")
        page = doc.load_page(page_number_1based - 1)
        rect = page.rect
        mat = fitz.Matrix(RENDER_DPI / 72.0, RENDER_DPI / 72.0)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        png_bytes = pix.tobytes("png")
        return png_bytes, float(rect.width), float(rect.height)
