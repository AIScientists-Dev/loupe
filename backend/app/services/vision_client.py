"""Claude vision wrapper: render a PDF page, verify a finding's quote,
and return a normalized bounding box.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings
from app.services.llm_client import _ANTHROPIC_URL, _extract_json_value

logger = logging.getLogger(__name__)


_VISION_SYSTEM = """You are verifying a finding in an academic paper against the rendered image of its source page.

You will receive:
  1. The page image (rendered from the PDF).
  2. A quoted passage that our text parser extracted from this page.
  3. The reasoning for a finding that depends on this passage being accurate.

Your jobs, in this order:

(A) Verify the passage is REALLY on this page.
    - Small rendering differences are OK: LaTeX commands vs glyph rendering, whitespace, line breaks, `\\epsilon` vs `ε`.
    - GROSS errors are NOT OK: scrambled symbols, missing entire subexpressions, swapped variables, the quote being on a different page, or being absent entirely.
    - If the passage is not actually present (parser hallucination / severe munging), set verified=false and explain in dropped_reason.

(B) Locate the passage. Return a bounding rectangle in NORMALIZED coordinates where (0,0) is top-left and (1,1) is bottom-right of the page image. Give a tight box around just the passage, not the whole paragraph.

Return ONLY a JSON object with these fields:
{
  "verified": true | false,
  "bbox_norm": {"x0": <0..1>, "y0": <0..1>, "x1": <0..1>, "y1": <0..1>} | null,
  "dropped_reason": "<short explanation>" | null
}
No markdown fences. No prose."""


class VisionClient:
    """Claude vision call dedicated to localize + verify. Opus 4.7 by default.

    Holds one long-lived httpx.AsyncClient so repeated localize calls reuse
    the SSL context (macOS + httpx reload is fragile under rapid creation).
    """

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=120.0)
        return self._client

    async def localize(
        self,
        page_png_bytes: bytes,
        evidence_quote: str,
        description: str,
    ) -> Dict[str, Any]:
        """Return {verified, bbox_norm, dropped_reason}. Raises on transport errors."""
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not configured")

        image_b64 = base64.b64encode(page_png_bytes).decode("ascii")
        user_content: List[Dict[str, Any]] = [
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": image_b64,
                },
            },
            {
                "type": "text",
                "text": (
                    f"Finding reasoning:\n{description}\n\n"
                    f"Passage the parser extracted (verbatim):\n\"\"\"\n{evidence_quote}\n\"\"\""
                ),
            },
        ]

        headers = {
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        body = {
            "model": settings.vision_model,
            "max_tokens": 1024,
            "system": _VISION_SYSTEM,
            "messages": [{"role": "user", "content": user_content}],
        }

        client = self._ensure_client()
        resp = await client.post(_ANTHROPIC_URL, headers=headers, json=body)
        if resp.status_code >= 400:
            logger.error("vision api %d: %s", resp.status_code, resp.text[:500])
            resp.raise_for_status()
        data = resp.json()

        text = "".join(
            b["text"] for b in data.get("content", []) if b.get("type") == "text"
        ).strip()
        return _parse_response(text)


def _parse_response(text: str) -> Dict[str, Any]:
    if not text:
        return {"verified": False, "bbox_norm": None, "dropped_reason": "empty vision response"}

    if text.startswith("```"):
        nl = text.find("\n")
        if nl >= 0:
            text = text[nl + 1:]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3].rstrip()

    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        extracted = _extract_json_value(text)
        if extracted is None:
            logger.warning("vision: could not parse JSON from response: %r", text[:200])
            return {"verified": False, "bbox_norm": None, "dropped_reason": "malformed vision response"}
        obj = json.loads(extracted)

    verified = bool(obj.get("verified"))
    bbox_raw = obj.get("bbox_norm")
    dropped = obj.get("dropped_reason")

    bbox_norm = _sanitize_bbox(bbox_raw) if verified else None
    if verified and bbox_norm is None:
        verified = False
        dropped = dropped or "vision returned no bounding box"

    return {"verified": verified, "bbox_norm": bbox_norm, "dropped_reason": dropped}


def _sanitize_bbox(raw: Any) -> Optional[Dict[str, float]]:
    if not isinstance(raw, dict):
        return None
    try:
        x0, y0, x1, y1 = (float(raw["x0"]), float(raw["y0"]), float(raw["x1"]), float(raw["y1"]))
    except (KeyError, TypeError, ValueError):
        return None
    x0 = max(0.0, min(1.0, x0))
    y0 = max(0.0, min(1.0, y0))
    x1 = max(0.0, min(1.0, x1))
    y1 = max(0.0, min(1.0, y1))
    if x1 <= x0 or y1 <= y0:
        return None
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1}
