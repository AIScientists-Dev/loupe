"""MinerU PDF parser client.

Calls MinerU's /file_parse once per paper. Builds:
  - markdown (reconstructed from content_list, not MinerU's md_content,
    so char offsets line up with page_map entries exactly).
  - page_map: list[PageMapEntry] with page, bbox, char_start, char_end, section.

Local fallback: if MINERU_API_URL is unset, PyMuPDF reads the PDF locally
(text-only blocks, no formula parsing).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.config import settings
from app.models import BoundingBox, PageMapEntry

logger = logging.getLogger(__name__)


class MinerUClient:
    async def parse_pdf(self, pdf_bytes: bytes, filename: str) -> Tuple[str, List[PageMapEntry]]:
        if settings.mineru_api_url:
            return await self._parse_remote(pdf_bytes, filename)
        logger.warning("MINERU_API_URL not set — using local PyMuPDF fallback (no formula parsing)")
        return self._parse_local(pdf_bytes)

    # -- remote: MinerU /file_parse -------------------------------------------

    async def _parse_remote(self, pdf_bytes: bytes, filename: str) -> Tuple[str, List[PageMapEntry]]:
        files = [("files", (filename, pdf_bytes, "application/pdf"))]
        data = {
            "backend": "pipeline",
            "return_content_list": "true",
            "return_md": "false",       # we rebuild it from content_list
            "parse_method": "auto",
            "formula_enable": "true",
            "table_enable": "true",
            "lang_list": "en",
        }
        async with httpx.AsyncClient(timeout=settings.mineru_timeout_seconds) as client:
            resp = await client.post(settings.mineru_api_url, files=files, data=data)
            resp.raise_for_status()
            result = resp.json()

        content_items = self._extract_content_list(result)
        if not content_items:
            raise RuntimeError("MinerU returned no content_list — PDF unreadable")

        return _build_markdown_and_pagemap(content_items)

    @staticmethod
    def _extract_content_list(result: Any) -> List[Dict]:
        if not isinstance(result, dict):
            return []
        results = result.get("results", {})
        if isinstance(results, dict):
            for file_result in results.values():
                if isinstance(file_result, dict):
                    cl = file_result.get("content_list")
                    if isinstance(cl, str):
                        try:
                            cl = json.loads(cl)
                        except json.JSONDecodeError:
                            continue
                    if isinstance(cl, list):
                        return cl
        cl = result.get("content_list")
        if isinstance(cl, str):
            try:
                cl = json.loads(cl)
            except json.JSONDecodeError:
                return []
        return cl if isinstance(cl, list) else []

    # -- local fallback: PyMuPDF ---------------------------------------------

    @staticmethod
    def _parse_local(pdf_bytes: bytes) -> Tuple[str, List[PageMapEntry]]:
        try:
            import fitz  # PyMuPDF
        except ImportError as e:
            raise RuntimeError("PyMuPDF (fitz) required for local PDF fallback") from e

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        items: List[Dict] = []
        for page_idx in range(doc.page_count):
            page = doc.load_page(page_idx)
            blocks = page.get_text("blocks")  # [(x0, y0, x1, y1, text, block_no, block_type), ...]
            blocks.sort(key=lambda b: (b[1], b[0]))  # top-to-bottom, left-to-right
            for b in blocks:
                x0, y0, x1, y1 = b[0], b[1], b[2], b[3]
                text = (b[4] or "").strip()
                if not text:
                    continue
                item_type = "title" if len(text) < 120 and text.count("\n") == 0 and text.isupper() else "text"
                items.append({
                    "type": item_type,
                    "text": text,
                    "bbox": [x0, y0, x1, y1],
                    "page_idx": page_idx,
                })
        doc.close()
        return _build_markdown_and_pagemap(items)


# ---------------------------------------------------------------------------
# Markdown + page_map construction
# ---------------------------------------------------------------------------

def _build_markdown_and_pagemap(content_items: List[Dict]) -> Tuple[str, List[PageMapEntry]]:
    """Render content_list items to markdown, tracking char offsets per block.

    Block type mapping:
      title/text_level>=1 → heading   (rendered as "# ..." / "## ...")
      text                → text
      equation            → equation  (display math, "$$...$$")
      inline_equation     → text (inlined into surrounding text)
      table               → table
      image, figure, image_caption, figure_caption → figure_caption
      discarded           → skipped
    """
    md_parts: List[str] = []
    page_map: List[PageMapEntry] = []
    current_section: Optional[str] = None
    cursor = 0

    for item in content_items:
        if not isinstance(item, dict):
            continue

        raw_type = item.get("type", "text")
        if raw_type == "discarded":
            continue

        text = (item.get("text") or item.get("content") or "").strip()
        if not text:
            continue

        text_level = item.get("text_level")
        if raw_type == "title" or (isinstance(text_level, int) and text_level >= 1):
            rendered = _render_heading(text, text_level)
            block_type = "heading"
            current_section = text
        elif raw_type == "equation":
            rendered = f"$$\n{text}\n$$\n\n"
            block_type = "equation"
        elif raw_type == "inline_equation":
            rendered = f"${text}$\n\n"
            block_type = "equation"
        elif raw_type == "table":
            rendered = f"{text}\n\n"
            block_type = "table"
        elif raw_type in {"image", "figure", "image_caption", "figure_caption", "table_caption"}:
            rendered = f"_{text}_\n\n"
            block_type = "figure_caption"
        else:
            rendered = f"{text}\n\n"
            block_type = "text"

        char_start = cursor
        md_parts.append(rendered)
        cursor += len(rendered)
        char_end = cursor

        bbox = _parse_bbox(item)
        page = int(item.get("page_idx", 0)) + 1

        page_map.append(PageMapEntry(
            page=page,
            block_type=block_type,
            char_start=char_start,
            char_end=char_end,
            bbox=bbox,
            section=current_section,
        ))

    return "".join(md_parts), page_map


def _render_heading(text: str, level: Optional[int]) -> str:
    lvl = level if isinstance(level, int) and 1 <= level <= 6 else 2
    prefix = "#" * lvl
    return f"{prefix} {text}\n\n"


def _parse_bbox(item: Dict) -> Optional[BoundingBox]:
    bbox_raw = item.get("bbox")
    if not isinstance(bbox_raw, list) or len(bbox_raw) < 4:
        return None
    try:
        x0, y0, x1, y1 = (float(bbox_raw[i]) for i in range(4))
    except (TypeError, ValueError):
        return None
    page = int(item.get("page_idx", 0)) + 1
    width = max(x1 - x0, 1.0)
    height = max(y1 - y0, 1.0)
    return BoundingBox(page=page, x=x0, y=y0, width=width, height=height)
