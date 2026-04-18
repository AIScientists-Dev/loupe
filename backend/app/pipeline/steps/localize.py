"""Localize step — per-page batch verification + refined bbox.

Claude sees each page image ONCE and adjudicates all findings that live on
that page in a single request. This is the main cost lever (16 per-finding
Opus calls → 2 per-page Sonnet calls on the fixture).

Side effects per finding:
  - verified → localize_status=done, bbox=refined rectangle (PDF points), visually_verified=True
  - not verified (parser munged) → localize_status=dropped, soft_deleted=True
  - transport / API error → localize_status stays pending (caller can retry)
"""
from __future__ import annotations

import logging
from typing import List

from app.models import BoundingBox, Finding, LocalizeStatus, Paper
from app.services.storage import FileStore
from app.services.vision_client import VisionClient

logger = logging.getLogger(__name__)


RENDER_DPI = 150  # good clarity vs. payload size; Sonnet handles this fine


async def localize_findings_on_page(
    paper: Paper,
    findings: List[Finding],
    store: FileStore,
    vision: VisionClient,
) -> None:
    """Run one batched vision call for all `findings`. All must share a page."""
    if not findings:
        return

    page_number = findings[0].page
    for f in findings:
        if f.page != page_number:
            raise ValueError("localize_findings_on_page: mixed pages in batch")

    pdf_bytes = store.load_pdf(paper.paper_id)
    if not pdf_bytes:
        logger.warning("localize: pdf missing for paper %s", paper.paper_id)
        return

    try:
        page_png, page_w_pts, page_h_pts = _render_page_png(pdf_bytes, page_number)
    except Exception:
        logger.exception("localize: could not render page %d for paper %s", page_number, paper.paper_id)
        return

    items = [
        {
            "id": f.finding_id,
            "evidence_quote": f.evidence_quote,
            "description": f.description,
        }
        for f in findings
    ]

    try:
        results = await vision.localize_batch(page_png, items)
    except Exception:
        logger.exception("localize: vision batch failed for page %d", page_number)
        return

    for f in findings:
        r = results.get(f.finding_id) or {
            "verified": False, "bbox_norm": None, "dropped_reason": "no result returned",
        }
        _apply_result(f, r, page_w_pts, page_h_pts)


def _apply_result(f: Finding, r: dict, page_w: float, page_h: float) -> None:
    verified = r.get("verified", False)
    bbox_norm = r.get("bbox_norm")
    dropped_reason = r.get("dropped_reason")

    if verified and bbox_norm:
        f.bbox = BoundingBox(
            page=f.page,
            x=bbox_norm["x0"] * page_w,
            y=bbox_norm["y0"] * page_h,
            width=max((bbox_norm["x1"] - bbox_norm["x0"]) * page_w, 1.0),
            height=max((bbox_norm["y1"] - bbox_norm["y0"]) * page_h, 1.0),
        )
        f.visually_verified = True
        f.localize_status = LocalizeStatus.done
        logger.info("localize: finding %s → verified", f.finding_id)
    else:
        f.visually_verified = False
        f.localize_status = LocalizeStatus.dropped
        f.soft_deleted = True
        logger.info("localize: finding %s → DROPPED (%s)", f.finding_id, dropped_reason or "unknown")


def _render_page_png(pdf_bytes: bytes, page_number_1based: int) -> tuple[bytes, float, float]:
    """Render the given page as PNG. Returns (png_bytes, width_pts, height_pts)."""
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
