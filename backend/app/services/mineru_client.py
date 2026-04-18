"""MinerU PDF parser client — calls AWS GPU endpoint or returns mock data."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx

from app.config import settings
from app.models import BoundingBox, ParsedBlock

logger = logging.getLogger(__name__)


class MinerUClient:
    """Calls MinerU on AWS GPU for structured PDF parsing."""

    async def parse_pdf(self, pdf_bytes: bytes, filename: str) -> List[ParsedBlock]:
        if not settings.mineru_api_url:
            logger.info("No MINERU_API_URL configured — using mock parser")
            return self._mock_parse(pdf_bytes)

        # MinerU API: POST /file_parse with files=[pdf], return_content_list=true
        files = [("files", (filename, pdf_bytes, "application/pdf"))]
        data = {
            "backend": "pipeline",
            "return_content_list": "true",
            "return_middle_json": "true",
            "return_md": "true",
            "parse_method": "auto",
            "formula_enable": "true",
            "table_enable": "true",
            "lang_list": "en",
        }

        async with httpx.AsyncClient(timeout=600.0) as client:
            resp = await client.post(
                settings.mineru_api_url, files=files, data=data
            )
            resp.raise_for_status()
            result = resp.json()

        return self._parse_mineru_response(result)

    def _parse_mineru_response(self, result: Any) -> List[ParsedBlock]:
        """Parse MinerU response into our ParsedBlock format.

        MinerU response shape:
        {
            "results": {
                "<filename>": {
                    "md_content": "...",
                    "content_list": "<JSON string>"  # flat list of dicts
                }
            }
        }

        Each content_list item:
        {"type": "text", "text": "...", "bbox": [x0, y0, x1, y1], "page_idx": 0}
        """
        blocks: List[ParsedBlock] = []

        # Extract content_list from nested results
        content_items = self._extract_content_list(result)
        md_content = self._extract_markdown(result)

        if content_items:
            for item in content_items:
                block = self._content_item_to_block(item, 1)
                if block:
                    blocks.append(block)

        # Fallback: parse markdown into blocks
        if not blocks and md_content:
            blocks = self._markdown_to_blocks(md_content)

        if not blocks:
            logger.warning("MinerU returned no parseable content, using mock")
            return self._mock_parse(b"")

        logger.info("MinerU parsed %d blocks from PDF", len(blocks))
        return blocks

    def _extract_content_list(self, result: Any) -> List[Dict]:
        """Extract and parse content_list from MinerU response."""
        if not isinstance(result, dict):
            return []

        # results is a dict keyed by filename
        results = result.get("results", {})
        if isinstance(results, dict):
            for file_result in results.values():
                if isinstance(file_result, dict):
                    cl = file_result.get("content_list")
                    if cl:
                        # content_list may be a JSON string or already a list
                        if isinstance(cl, str):
                            try:
                                cl = json.loads(cl)
                            except json.JSONDecodeError:
                                continue
                        if isinstance(cl, list):
                            return cl

        # Direct content_list at top level
        cl = result.get("content_list")
        if cl:
            if isinstance(cl, str):
                try:
                    cl = json.loads(cl)
                except json.JSONDecodeError:
                    return []
            if isinstance(cl, list):
                return cl

        return []

    def _extract_markdown(self, result: Any) -> str:
        """Extract markdown content from response."""
        if not isinstance(result, dict):
            return ""
        results = result.get("results", {})
        if isinstance(results, dict):
            for file_result in results.values():
                if isinstance(file_result, dict):
                    md = file_result.get("md_content", "")
                    if md:
                        return md
        return result.get("md_content", "")

    @staticmethod
    def _content_item_to_block(item: Any, fallback_page: int) -> Optional[ParsedBlock]:
        """Convert a MinerU content_list item into a ParsedBlock.

        MinerU item format:
        {"type": "text", "text": "...", "text_level": 1, "bbox": [x0, y0, x1, y1], "page_idx": 0}
        """
        if not isinstance(item, dict):
            return None

        # Skip discarded blocks
        item_type = item.get("type", "text")
        if item_type == "discarded":
            return None

        content = item.get("text", item.get("content", ""))
        if not content or not content.strip():
            return None

        # Map MinerU types to our types
        type_map = {
            "text": "text",
            "title": "heading",
            "equation": "equation",
            "inline_equation": "equation",
            "table": "table",
            "image": "figure_caption",
            "figure": "figure_caption",
            "image_caption": "figure_caption",
            "table_caption": "table",
        }
        block_type = type_map.get(item_type, "text")

        # text_level 1 = heading
        if item.get("text_level") == 1:
            block_type = "heading"

        # page_idx is 0-based
        page_num = item.get("page_idx", fallback_page - 1) + 1

        # bbox is [x0, y0, x1, y1]
        bbox_raw = item.get("bbox", [])
        if isinstance(bbox_raw, list) and len(bbox_raw) >= 4:
            x0, y0, x1, y1 = float(bbox_raw[0]), float(bbox_raw[1]), float(bbox_raw[2]), float(bbox_raw[3])
            bbox = BoundingBox(
                page=page_num,
                x=x0,
                y=y0,
                width=max(x1 - x0, 1),
                height=max(y1 - y0, 1),
            )
        else:
            bbox = BoundingBox(page=page_num, x=72, y=72, width=468, height=20)

        return ParsedBlock(
            block_type=block_type,
            content=content.strip(),
            page=page_num,
            bbox=bbox,
        )

    @staticmethod
    def _markdown_to_blocks(md: str) -> List[ParsedBlock]:
        """Fallback: split markdown into rough blocks by paragraph."""
        blocks: List[ParsedBlock] = []
        paragraphs = [p.strip() for p in md.split("\n\n") if p.strip()]
        y_offset = 72
        for para in paragraphs:
            block_type = "heading" if para.startswith("#") else "text"
            content = para.lstrip("#").strip()
            blocks.append(ParsedBlock(
                block_type=block_type,
                content=content,
                page=1,
                bbox=BoundingBox(page=1, x=72, y=y_offset, width=468, height=20),
            ))
            y_offset += 30
        return blocks

    @staticmethod
    def _mock_parse(pdf_bytes: bytes) -> List[ParsedBlock]:
        """Local fallback with realistic mock blocks for testing."""
        return [
            ParsedBlock(
                block_type="heading",
                content="On the Convergence Properties of Gradient Descent in Non-Convex Settings",
                page=1,
                bbox=BoundingBox(page=1, x=72, y=72, width=468, height=24),
            ),
            ParsedBlock(
                block_type="text",
                content="Abstract: We study the convergence behavior of gradient descent methods applied to non-convex optimization problems. Our main contribution is a novel proof showing that under mild regularity conditions, gradient descent achieves a convergence rate of O(1/sqrt(T)) to first-order stationary points.",
                page=1,
                bbox=BoundingBox(page=1, x=72, y=120, width=468, height=60),
            ),
            ParsedBlock(
                block_type="text",
                content="Theorem 3.2: Let f be L-smooth and bounded below. Then gradient descent with step size eta = 1/L satisfies min_{t=0..T} ||grad f(x_t)|| <= sqrt(2L(f(x_0) - f*)/T).",
                page=3,
                bbox=BoundingBox(page=3, x=72, y=200, width=468, height=40),
            ),
            ParsedBlock(
                block_type="text",
                content="Proof of Theorem 3.2: By L-smoothness we have f(x_{t+1}) <= f(x_t) - (1/2L)||grad f(x_t)||^2. Summing from t=0 to T-1 and using f(x_T) >= f*, we obtain the result. Note that the base case P(0) follows from the initial condition.",
                page=3,
                bbox=BoundingBox(page=3, x=72, y=260, width=468, height=80),
            ),
            ParsedBlock(
                block_type="equation",
                content="E[||grad f(x_t)||^2] <= (2L * (f(x_0) - f*)) / T + sigma^2 / sqrt(T)",
                page=4,
                bbox=BoundingBox(page=4, x=120, y=180, width=360, height=30),
            ),
            ParsedBlock(
                block_type="text",
                content="Equation (14) follows from combining Lemma 3.1 with the variance bound. The left-hand side operates in R^d while the projection matrix W maps to R^{d+1}, yielding the stated result after applying the trace inequality.",
                page=4,
                bbox=BoundingBox(page=4, x=72, y=230, width=468, height=60),
            ),
            ParsedBlock(
                block_type="text",
                content="Our approach is novel compared to prior work [1,2,3] which required strong convexity assumptions. We relax this to L-smoothness only, which is a strictly weaker condition.",
                page=5,
                bbox=BoundingBox(page=5, x=72, y=100, width=468, height=40),
            ),
            ParsedBlock(
                block_type="text",
                content="Related Work: [1] Nesterov (2004) established convergence rates for convex functions. [2] Ghadimi & Lan (2013) studied stochastic gradient methods under convexity. [3] Carmon et al. (2018) provided lower bounds for non-convex optimization.",
                page=6,
                bbox=BoundingBox(page=6, x=72, y=72, width=468, height=60),
            ),
        ]
