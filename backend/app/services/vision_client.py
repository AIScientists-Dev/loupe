"""Claude vision wrapper: render a PDF page once, verify N finding quotes
in a single request, and return per-finding bounding boxes.

Batching by page is the key cost optimization — Claude sees the page image
once, and emits an array of {id, verified, bbox_norm, dropped_reason} rows
keyed by the caller-supplied `id`.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings
from app.services.llm_client import _ANTHROPIC_URL, _extract_json_value, usage_tracker

logger = logging.getLogger(__name__)


_VISION_SYSTEM_BATCH = """You are verifying one-or-more findings in an academic paper against the rendered image of their shared source page.

You will receive:
  1. The page image (rendered from the PDF).
  2. A numbered list of findings. Each has: id, evidence_quote (what the parser extracted), description (why it was flagged).

For EACH finding, do both:

(A) Verify the evidence_quote is really on this page.
    - Small rendering differences are OK: LaTeX commands vs glyph rendering, whitespace, line breaks, `\\epsilon` vs `ε`.
    - GROSS errors are NOT OK: scrambled symbols, missing subexpressions, swapped variables, passage absent entirely, or passage lives on a different page.
    - If not verified, set verified=false and fill dropped_reason.

(B) Locate the passage. Return a TIGHT bounding rectangle around just that passage in NORMALIZED coordinates where (0,0) is the top-left and (1,1) is the bottom-right of the page image. Do not include surrounding paragraphs.

Return ONLY a JSON array, one element per finding, in the same order as the input:
[
  {"id": "<the id we gave>", "verified": true|false, "bbox_norm": {"x0": <0..1>, "y0": <0..1>, "x1": <0..1>, "y1": <0..1>} | null, "dropped_reason": "<short reason>" | null},
  ...
]
No markdown fences. No prose."""


class VisionClient:
    """Claude vision call dedicated to localize + verify.

    Holds one long-lived httpx.AsyncClient so repeated calls reuse the SSL
    context and connection pool.
    """

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=180.0)
        return self._client

    async def localize_batch(
        self,
        page_png_bytes: bytes,
        items: List[Dict[str, str]],
    ) -> Dict[str, Dict[str, Any]]:
        """Send one page image + N findings, return {finding_id: result}.

        `items` is a list of {id, evidence_quote, description}. The vision
        model returns a JSON array; we map it back by id.
        """
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not configured")
        if not items:
            return {}

        image_b64 = base64.b64encode(page_png_bytes).decode("ascii")
        listing_lines = []
        for i, it in enumerate(items, 1):
            listing_lines.append(
                f"Finding {i}:\n"
                f"  id: {it['id']}\n"
                f"  description: {it.get('description','')}\n"
                f"  evidence_quote: \"\"\"{it.get('evidence_quote','')}\"\"\"\n"
            )
        listing = "\n".join(listing_lines)

        user_content: List[Dict[str, Any]] = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": image_b64},
            },
            {
                "type": "text",
                "text": f"The page image is above. Review these findings:\n\n{listing}\n\nReturn the JSON array.",
            },
        ]

        model = settings.vision_model
        headers = {
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        body: Dict[str, Any] = {
            "model": model,
            "max_tokens": 1024 + 400 * len(items),   # scale with N
            "system": _VISION_SYSTEM_BATCH,
            "messages": [{"role": "user", "content": user_content}],
        }
        # Opus 4.7 rejects temperature; Sonnet accepts it.
        if not model.startswith("claude-opus-4-7"):
            body["temperature"] = 0.0

        client = self._ensure_client()
        resp = await client.post(_ANTHROPIC_URL, headers=headers, json=body)
        if resp.status_code >= 400:
            logger.error("vision api %d: %s", resp.status_code, resp.text[:500])
            resp.raise_for_status()
        data = resp.json()

        usage_tracker.record(model, data.get("usage", {}) or {}, tag=f"vision.batch[{len(items)}]")

        text = "".join(
            b["text"] for b in data.get("content", []) if b.get("type") == "text"
        ).strip()
        return _parse_batch(text, [it["id"] for it in items])


    async def verify_quote_on_page(
        self,
        page_png_bytes: bytes,
        evidence_quote: str,
    ) -> Dict[str, Any]:
        """Binary presence check. Returns {present: bool, confidence: 0..100}.

        Used as a safety valve after the deterministic text anchor lands a
        candidate page — answers only 'is this quote visible on this page?'.
        Does NOT return coordinates; we never let vision pick pixels.
        """
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not configured")
        if not evidence_quote:
            return {"present": False, "confidence": 0}

        image_b64 = base64.b64encode(page_png_bytes).decode("ascii")
        system = (
            "You check whether an exact string is visible on a rendered paper page.\n"
            "Only say present=true if the EXACT string appears on the page — not a similar equation, not a paraphrase.\n"
            "Small differences in how LaTeX renders vs plain text (e.g. \\lambda vs λ, \\{ vs {) are fine.\n"
            "Return JSON only: {\"present\": bool, \"confidence\": 0..100}."
        )
        user_content: List[Dict[str, Any]] = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": image_b64},
            },
            {
                "type": "text",
                "text": (
                    "Is the following string visible on this page?\n\n"
                    f"\"\"\"\n{evidence_quote}\n\"\"\"\n\n"
                    "Return JSON only."
                ),
            },
        ]

        model = settings.vision_model
        body: Dict[str, Any] = {
            "model": model,
            "max_tokens": 200,
            "system": system,
            "messages": [{"role": "user", "content": user_content}],
        }
        if not model.startswith("claude-opus-4-7"):
            body["temperature"] = 0.0
        headers = {
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        client = self._ensure_client()
        resp = await client.post(_ANTHROPIC_URL, headers=headers, json=body)
        if resp.status_code >= 400:
            logger.error("vision presence api %d: %s", resp.status_code, resp.text[:500])
            resp.raise_for_status()
        data = resp.json()
        usage_tracker.record(model, data.get("usage", {}) or {}, tag="vision.presence")

        text = "".join(
            b["text"] for b in data.get("content", []) if b.get("type") == "text"
        ).strip()
        if text.startswith("```"):
            nl = text.find("\n")
            if nl >= 0:
                text = text[nl + 1:]
            if text.rstrip().endswith("```"):
                text = text.rstrip()[:-3].rstrip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            extracted = _extract_json_value(text)
            if extracted is None:
                logger.warning("vision.presence: unparseable response: %r", text[:200])
                return {"present": False, "confidence": 0}
            parsed = json.loads(extracted)
        if not isinstance(parsed, dict):
            return {"present": False, "confidence": 0}
        present = bool(parsed.get("present"))
        try:
            conf = max(0, min(100, int(parsed.get("confidence", 0))))
        except (TypeError, ValueError):
            conf = 0
        return {"present": present, "confidence": conf}


    async def disambiguate_candidates(
        self,
        page_png_bytes: bytes,
        evidence_quote: str,
        candidates: List[Dict[str, str]],
    ) -> Dict[str, Any]:
        """Tier-3 disambiguation. Given a page image and a list of candidate
        context snippets (each one = text surrounding one plausible occurrence
        of the quote), ask vision which candidate index is the correct match.

        Returns {picked: int | null, confidence: 0..100}.
        Vision never returns coordinates — it only picks an index.
        """
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not configured")
        if not candidates:
            return {"picked": None, "confidence": 0}

        image_b64 = base64.b64encode(page_png_bytes).decode("ascii")
        system = (
            "You disambiguate between multiple plausible locations on a paper page "
            "where a specific evidence quote might appear.\n"
            "You see the rendered page image and a numbered list of candidate context "
            "snippets (text surrounding each candidate occurrence in the source).\n"
            "Pick ONE candidate index whose surrounding text matches the actual visual "
            "context on the page. If none of them match the visible page, return null.\n"
            "Return JSON only: {\"picked\": <0-based int> | null, \"confidence\": 0..100}."
        )
        cand_lines = []
        for i, c in enumerate(candidates):
            cand_lines.append(
                f"Candidate {i}:\n"
                f"  context: \"\"\"{c.get('context', '')}\"\"\""
            )
        user_text = (
            f"Evidence quote we're locating:\n\"\"\"\n{evidence_quote}\n\"\"\"\n\n"
            f"Candidates (pick one index whose surrounding context matches the page):\n\n"
            + "\n\n".join(cand_lines)
            + "\n\nReturn JSON only."
        )
        user_content: List[Dict[str, Any]] = [
            {
                "type": "image",
                "source": {"type": "base64", "media_type": "image/png", "data": image_b64},
            },
            {"type": "text", "text": user_text},
        ]
        model = settings.vision_model
        body: Dict[str, Any] = {
            "model": model,
            "max_tokens": 200,
            "system": system,
            "messages": [{"role": "user", "content": user_content}],
        }
        if not model.startswith("claude-opus-4-7"):
            body["temperature"] = 0.0
        headers = {
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        client = self._ensure_client()
        resp = await client.post(_ANTHROPIC_URL, headers=headers, json=body)
        if resp.status_code >= 400:
            logger.error("vision disambig api %d: %s", resp.status_code, resp.text[:500])
            resp.raise_for_status()
        data = resp.json()
        usage_tracker.record(model, data.get("usage", {}) or {}, tag="vision.disambiguate")

        text = "".join(
            b["text"] for b in data.get("content", []) if b.get("type") == "text"
        ).strip()
        if text.startswith("```"):
            nl = text.find("\n")
            if nl >= 0:
                text = text[nl + 1:]
            if text.rstrip().endswith("```"):
                text = text.rstrip()[:-3].rstrip()
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            extracted = _extract_json_value(text)
            if extracted is None:
                logger.warning("vision.disambiguate: unparseable response: %r", text[:200])
                return {"picked": None, "confidence": 0}
            parsed = json.loads(extracted)
        if not isinstance(parsed, dict):
            return {"picked": None, "confidence": 0}
        picked = parsed.get("picked")
        if picked is not None:
            try:
                picked = int(picked)
                if picked < 0 or picked >= len(candidates):
                    picked = None
            except (TypeError, ValueError):
                picked = None
        try:
            conf = max(0, min(100, int(parsed.get("confidence", 0))))
        except (TypeError, ValueError):
            conf = 0
        return {"picked": picked, "confidence": conf}


def _parse_batch(text: str, expected_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    if not text:
        return {i: {"verified": False, "bbox_norm": None, "dropped_reason": "empty vision response"} for i in expected_ids}

    if text.startswith("```"):
        nl = text.find("\n")
        if nl >= 0:
            text = text[nl + 1:]
        if text.rstrip().endswith("```"):
            text = text.rstrip()[:-3].rstrip()

    try:
        arr = json.loads(text)
    except json.JSONDecodeError:
        extracted = _extract_json_value(text)
        if extracted is None:
            logger.warning("vision.batch: could not parse JSON from response: %r", text[:200])
            return {i: {"verified": False, "bbox_norm": None, "dropped_reason": "malformed vision response"} for i in expected_ids}
        arr = json.loads(extracted)

    if not isinstance(arr, list):
        arr = [arr]

    for row in arr:
        if not isinstance(row, dict):
            continue
        rid = str(row.get("id", "")).strip()
        if not rid:
            continue
        verified = bool(row.get("verified"))
        bbox = _sanitize_bbox(row.get("bbox_norm")) if verified else None
        dropped = row.get("dropped_reason")
        if verified and bbox is None:
            verified = False
            dropped = dropped or "vision returned no bounding box"
        out[rid] = {"verified": verified, "bbox_norm": bbox, "dropped_reason": dropped}

    # Fill missing IDs.
    for i in expected_ids:
        if i not in out:
            out[i] = {"verified": False, "bbox_norm": None, "dropped_reason": "vision omitted this id"}
    return out


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
