"""Outline extraction — fast, local, free.

Produces a list of candidate headings with page numbers using:
  1. The PDF's embedded TOC (get_toc) if present.
  2. Otherwise, font-size heuristics on the rendered text blocks.

Output is consumed by plan_segments.py (one cheap LLM call) to produce the
final segment plan.
"""
from __future__ import annotations

import logging
from statistics import median
from typing import List, Tuple

from app.models import OutlineHeading

logger = logging.getLogger(__name__)

# Font-size threshold for "this might be a heading" — times the body-text median.
HEADING_FONT_MULTIPLIER = 1.18
# Max heading length (chars) — titles and section names are short.
HEADING_MAX_CHARS = 200
# Min heading length (chars) — skip page numbers, line numbers, orphan letters.
HEADING_MIN_CHARS = 3


def extract_outline(pdf_bytes: bytes) -> Tuple[List[OutlineHeading], int]:
    """Return (headings, page_count). Never raises on a valid PDF."""
    import fitz  # PyMuPDF
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    try:
        page_count = doc.page_count
        toc = _from_toc(doc)
        if toc:
            return toc, page_count
        # Fallback: font-size heuristic.
        return _from_fonts(doc), page_count
    finally:
        doc.close()


def _from_toc(doc) -> List[OutlineHeading]:
    """Embedded PDF TOC (\\tableofcontents exported). Returns [] if absent."""
    try:
        toc = doc.get_toc(simple=False)  # [[level, title, page, dict], ...]
    except Exception:
        return []

    out: List[OutlineHeading] = []
    for entry in toc:
        if len(entry) < 3:
            continue
        level, title, page = entry[0], entry[1], entry[2]
        title = (title or "").strip()
        if not title or len(title) > HEADING_MAX_CHARS or len(title) < HEADING_MIN_CHARS:
            continue
        if not isinstance(page, int) or page < 1:
            continue
        out.append(OutlineHeading(page=int(page), text=title, level=int(level) if level else 1))
    return out


def _from_fonts(doc) -> List[OutlineHeading]:
    """Scan each page's text spans; flag spans whose font is clearly bigger
    than the median as headings."""
    all_spans: List[dict] = []    # collected to compute the median body size
    for page_idx in range(doc.page_count):
        page = doc.load_page(page_idx)
        blocks = page.get_text("dict").get("blocks", [])
        for block in blocks:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    if span.get("text", "").strip():
                        all_spans.append({
                            "text": span["text"],
                            "size": float(span.get("size", 0)),
                            "page": page_idx + 1,
                        })

    if not all_spans:
        return []
    body_size = median(s["size"] for s in all_spans)
    threshold = body_size * HEADING_FONT_MULTIPLIER

    # Coalesce consecutive spans from the same line of the same font; emit as
    # a heading only if the line text is short enough and the size exceeds
    # threshold.
    out: List[OutlineHeading] = []
    for page_idx in range(doc.page_count):
        page = doc.load_page(page_idx)
        blocks = page.get_text("dict").get("blocks", [])
        for block in blocks:
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                spans = line.get("spans", [])
                if not spans:
                    continue
                line_text = "".join(s.get("text", "") for s in spans).strip()
                if not line_text or len(line_text) > HEADING_MAX_CHARS or len(line_text) < HEADING_MIN_CHARS:
                    continue
                max_size = max(float(s.get("size", 0)) for s in spans)
                if max_size >= threshold:
                    level = _guess_level(max_size, body_size)
                    out.append(OutlineHeading(
                        page=page_idx + 1, text=line_text, level=level, font_size=max_size,
                    ))

    # Dedupe adjacent repeats (some PDFs draw headings twice for layering).
    dedup: List[OutlineHeading] = []
    for h in out:
        if dedup and dedup[-1].page == h.page and dedup[-1].text == h.text:
            continue
        dedup.append(h)
    return dedup


def _guess_level(heading_size: float, body_size: float) -> int:
    ratio = heading_size / max(body_size, 1.0)
    if ratio >= 1.8:
        return 1
    if ratio >= 1.45:
        return 2
    if ratio >= 1.25:
        return 3
    return 4
