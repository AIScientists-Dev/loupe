"""Step 1 — parse PDF via MinerU (or local PyMuPDF fallback).

Sets: paper.markdown, paper.page_map, paper.title (heuristic).
"""
from __future__ import annotations

from app.models import Paper
from app.services.mineru_client import MinerUClient
from app.services.storage import FileStore


async def run_parse(paper: Paper, store: FileStore, mineru: MinerUClient) -> None:
    pdf_bytes = store.load_pdf(paper.paper_id)
    if not pdf_bytes:
        raise FileNotFoundError(f"PDF missing for paper {paper.paper_id}")

    markdown, page_map = await mineru.parse_pdf(pdf_bytes, paper.filename)
    paper.markdown = markdown
    paper.page_map = page_map
    paper.title = _extract_title(page_map, markdown) or paper.title


def _extract_title(page_map, markdown: str) -> str | None:
    """First page-1 heading → title (reasonably short)."""
    for entry in page_map:
        if entry.block_type == "heading" and entry.page == 1:
            snippet = markdown[entry.char_start:entry.char_end].strip()
            snippet = snippet.lstrip("#").strip()
            if snippet and len(snippet) < 300:
                return snippet
    return None
