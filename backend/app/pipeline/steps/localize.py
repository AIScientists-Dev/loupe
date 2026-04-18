"""Localize step — per-finding visual verification + refined bbox.

Called on-demand (POST .../findings/{fid}/localize) and as auto-fanout after
verify_proofs completes. Uses PyMuPDF to render the single relevant page,
then asks Claude vision to verify the quote and return a normalized bbox.

Side effects on the finding:
  - verified → localize_status=done, bbox=refined rectangle (PDF points), visually_verified=True
  - not verified (parser munged) → localize_status=dropped, soft_deleted=True
  - transport error → localize_status stays pending (caller can retry)
"""
from __future__ import annotations

import io
import logging
from typing import Optional

from app.models import BoundingBox, Finding, LocalizeStatus, Paper
from app.services.storage import FileStore
from app.services.vision_client import VisionClient

logger = logging.getLogger(__name__)


RENDER_DPI = 150  # good clarity vs. payload size


async def localize_finding(
    paper: Paper,
    finding: Finding,
    store: FileStore,
    vision: VisionClient,
) -> Finding:
    """Run visual localize on a single finding. Mutates the finding in-place."""
    pdf_bytes = store.load_pdf(paper.paper_id)
    if not pdf_bytes:
        logger.warning("localize: pdf missing for paper %s", paper.paper_id)
        return finding

    try:
        page_png, page_width_pts, page_height_pts = _render_page_png(pdf_bytes, finding.page)
    except Exception as exc:
        logger.exception("localize: could not render page %d for paper %s", finding.page, paper.paper_id)
        return finding  # leave as pending; caller may retry

    try:
        result = await vision.localize(page_png, finding.evidence_quote, finding.description)
    except Exception as exc:
        logger.exception("localize: vision call failed for finding %s", finding.finding_id)
        return finding  # leave pending

    verified = result.get("verified", False)
    bbox_norm = result.get("bbox_norm")
    dropped_reason = result.get("dropped_reason")

    if verified and bbox_norm:
        finding.bbox = BoundingBox(
            page=finding.page,
            x=bbox_norm["x0"] * page_width_pts,
            y=bbox_norm["y0"] * page_height_pts,
            width=max((bbox_norm["x1"] - bbox_norm["x0"]) * page_width_pts, 1.0),
            height=max((bbox_norm["y1"] - bbox_norm["y0"]) * page_height_pts, 1.0),
        )
        finding.visually_verified = True
        finding.localize_status = LocalizeStatus.done
        logger.info("localize: finding %s → verified, bbox refined", finding.finding_id)
    else:
        finding.visually_verified = False
        finding.localize_status = LocalizeStatus.dropped
        finding.soft_deleted = True
        logger.info(
            "localize: finding %s → DROPPED (%s)",
            finding.finding_id, dropped_reason or "unknown",
        )

    return finding


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
