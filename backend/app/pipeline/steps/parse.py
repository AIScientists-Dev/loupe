"""Parse one page range via MinerU (or local PyMuPDF fallback).

Used by the segment scheduler. Returns (markdown, page_map, elapsed_seconds).
The caller merges the result into the paper's aggregate markdown/page_map.
"""
from __future__ import annotations

from typing import List, Optional, Tuple

from app.models import PageMapEntry
from app.services.mineru_client import MinerUClient, MinerUParseResult


async def parse_page_range(
    pdf_bytes: bytes,
    filename: str,
    mineru: MinerUClient,
    page_start: Optional[int] = None,
    page_end: Optional[int] = None,
) -> Tuple[str, List[PageMapEntry], float]:
    result: MinerUParseResult = await mineru.parse_pdf(
        pdf_bytes, filename,
        page_start=page_start, page_end=page_end,
    )
    return result.markdown, result.page_map, result.elapsed_seconds


def extract_title_from(page_map, markdown: str) -> str | None:
    """First page-1 heading → title (short ones only)."""
    for entry in page_map:
        if entry.block_type == "heading" and entry.page == 1:
            snippet = markdown[entry.char_start:entry.char_end].strip()
            snippet = snippet.lstrip("#").strip()
            if snippet and len(snippet) < 300:
                return snippet
    return None
