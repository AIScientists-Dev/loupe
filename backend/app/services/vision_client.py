"""Vision wrapper for findings localization + presence checks.

Handles two API shapes today:

  * Cloud and self-hosted endpoints that speak the OpenAI Chat-Completions
    schema (``image_url`` content parts, ``Authorization: Bearer`` header).
    Used for ``gpt-*``, ``o1``/``o3``/``o4`` reasoning models, and any
    ``local:<name>`` route configured against ``LOCAL_OPENAI_BASE_URL``.
  * Endpoints using the vendor-prefixed schema with ``image`` source
    objects, ``x-api-key`` header, and a top-level ``system`` field.
    Used for ``claude-*`` model ids.

Selection is driven by ``settings.vision_model`` — the first matching
prefix wins. Each call site is shape-agnostic: it builds a list of
``(text, image)`` parts, hands them to ``_dispatch``, and parses the
returned text uniformly.
"""
from __future__ import annotations

import base64
import json
import logging
from typing import Any, Dict, List, Optional, Tuple

import httpx

from app.config import settings
from app.services.llm_client import (
    _ANTHROPIC_URL,
    _OPENAI_URL,
    _extract_json_value,
    usage_tracker,
)

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


# ---------------------------------------------------------------------------
# Provider dispatch — single place that knows about each vision provider.
# ---------------------------------------------------------------------------


def _vision_dispatch() -> Tuple[str, str, str, str]:
    """Resolve the configured vision model to (url, api_format, api_key, model).

    api_format is "anthropic" (vendor JSON shape) or "openai" (Chat Completions
    shape). Raises ``RuntimeError`` if the configured model has no provider
    routing or the matching API key isn't set.
    """
    model = settings.vision_model
    if not model:
        raise RuntimeError("VISION_MODEL is not configured")

    # Vendor-prefixed JSON shape (image source objects, x-api-key).
    if model.startswith("claude-"):
        if not settings.anthropic_api_key:
            raise RuntimeError("ANTHROPIC_API_KEY not configured for vision")
        return _ANTHROPIC_URL, "anthropic", settings.anthropic_api_key, model

    # OpenAI Chat-Completions shape (image_url parts, Authorization Bearer).
    if (
        model.startswith("gpt")
        or model.startswith("o1")
        or model.startswith("o3")
        or model.startswith("o4")
    ):
        if not settings.openai_api_key:
            raise RuntimeError("OPENAI_API_KEY not configured for vision")
        return _OPENAI_URL, "openai", settings.openai_api_key, model

    # Local OpenAI-compatible endpoint (vLLM / LM Studio / llama.cpp / proxies).
    # Address as "local:<served-name>" — the served name is what we forward
    # to the endpoint as `model`.
    if model.startswith("local:"):
        base = (settings.local_openai_base_url or "").rstrip("/")
        if not base:
            raise RuntimeError(
                "LOCAL_OPENAI_BASE_URL not configured for vision (model=%s)" % model
            )
        served = model.split(":", 1)[1] or model
        url = f"{base}/v1/chat/completions"
        return url, "openai", settings.local_openai_api_key or "", served

    raise RuntimeError(
        f"Unsupported vision model: {model!r}. "
        "Use a 'claude-*', 'gpt-*' / 'o1-*' / 'o3-*' / 'o4-*', or 'local:<name>' id."
    )


def _build_payload(
    api_format: str,
    *,
    model: str,
    system_text: str,
    user_text: str,
    image_b64: str,
    max_tokens: int,
) -> Tuple[Dict[str, str], Dict[str, Any]]:
    """Build (headers, body) for one vision request, given the API format."""
    if api_format == "anthropic":
        headers = {
            "x-api-key": "<set-by-caller>",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        body: Dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "system": system_text,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": image_b64,
                            },
                        },
                        {"type": "text", "text": user_text},
                    ],
                }
            ],
        }
        # Some reasoning-tier ids reject temperature; the rest deterministic.
        if not _omits_temperature(model):
            body["temperature"] = 0.0
        return headers, body

    if api_format == "openai":
        headers = {
            "Authorization": "Bearer <set-by-caller>",
            "Content-Type": "application/json",
        }
        body = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": [
                {"role": "system", "content": system_text},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{image_b64}"
                            },
                        },
                    ],
                },
            ],
        }
        if not _omits_temperature(model):
            body["temperature"] = 0.0
        return headers, body

    raise RuntimeError(f"Unknown api_format: {api_format!r}")


def _omits_temperature(model: str) -> bool:
    """Models that reject the ``temperature`` parameter outright."""
    # Reasoning-tier ids and one specific frontier model.
    return (
        model.startswith("o1")
        or model.startswith("o3")
        or model.startswith("o4")
        or model.startswith("claude-opus-4-7")
    )


def _extract_text(api_format: str, data: Dict[str, Any]) -> str:
    if api_format == "openai":
        try:
            return (data["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError):
            return ""
    if api_format == "anthropic":
        return "".join(
            b.get("text", "")
            for b in data.get("content", [])
            if b.get("type") == "text"
        ).strip()
    return ""


def _record_usage(api_format: str, model: str, data: Dict[str, Any], tag: str) -> None:
    """Normalize provider-specific usage shapes into the tracker's schema."""
    raw = data.get("usage", {}) or {}
    if api_format == "openai":
        # Chat Completions returns prompt_tokens / completion_tokens; some
        # providers also expose prompt_tokens_details with cached counts.
        cached = 0
        details = raw.get("prompt_tokens_details") or {}
        try:
            cached = int(details.get("cached_tokens", 0) or 0)
        except (TypeError, ValueError):
            cached = 0
        normalized = {
            "input_tokens": int(raw.get("prompt_tokens", 0) or 0) - cached,
            "output_tokens": int(raw.get("completion_tokens", 0) or 0),
            "cache_read_input_tokens": cached,
        }
        usage_tracker.record(model, normalized, tag=tag)
        return
    usage_tracker.record(model, raw, tag=tag)


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class VisionClient:
    """Vision call dedicated to localize + verify.

    Holds one long-lived httpx.AsyncClient so repeated calls reuse the SSL
    context and connection pool. Picks the provider on every call from
    ``settings.vision_model`` so a hot-reload of env can switch between
    cloud and local without restarting the process.
    """

    def __init__(self) -> None:
        self._client: httpx.AsyncClient | None = None

    def _ensure_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=180.0)
        return self._client

    async def _post(
        self,
        *,
        system_text: str,
        user_text: str,
        image_b64: str,
        max_tokens: int,
        tag: str,
    ) -> str:
        """One request → one assistant text. Provider-agnostic."""
        url, fmt, api_key, model = _vision_dispatch()
        headers, body = _build_payload(
            fmt,
            model=model,
            system_text=system_text,
            user_text=user_text,
            image_b64=image_b64,
            max_tokens=max_tokens,
        )
        # Inject the actual key (kept out of the builder so nobody can log
        # a placeholder bearer string and think the call's auth is set).
        if fmt == "anthropic":
            headers["x-api-key"] = api_key
        elif fmt == "openai":
            headers["Authorization"] = f"Bearer {api_key}" if api_key else ""
            if not api_key:
                # Some local endpoints don't need auth — drop the empty
                # bearer rather than send "Bearer " which some servers 400 on.
                headers.pop("Authorization", None)

        client = self._ensure_client()
        resp = await client.post(url, headers=headers, json=body)
        if resp.status_code >= 400:
            logger.error(
                "vision api %s %d: %s",
                fmt,
                resp.status_code,
                resp.text[:500],
            )
            resp.raise_for_status()
        data = resp.json()
        _record_usage(fmt, model, data, tag=tag)
        return _extract_text(fmt, data)

    # -- batch localize ----------------------------------------------------

    async def localize_batch(
        self,
        page_png_bytes: bytes,
        items: List[Dict[str, str]],
    ) -> Dict[str, Dict[str, Any]]:
        """Send one page image + N findings, return {finding_id: result}.

        ``items`` is a list of {id, evidence_quote, description}. The vision
        model returns a JSON array; we map it back by id.
        """
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
        user_text = (
            f"The page image is above. Review these findings:\n\n{listing}\n\n"
            "Return the JSON array."
        )

        text = await self._post(
            system_text=_VISION_SYSTEM_BATCH,
            user_text=user_text,
            image_b64=image_b64,
            max_tokens=1024 + 400 * len(items),
            tag=f"vision.batch[{len(items)}]",
        )
        return _parse_batch(text, [it["id"] for it in items])

    # -- presence check ----------------------------------------------------

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
        if not evidence_quote:
            return {"present": False, "confidence": 0}

        image_b64 = base64.b64encode(page_png_bytes).decode("ascii")
        system = (
            "You check whether an exact string is visible on a rendered paper page.\n"
            "Only say present=true if the EXACT string appears on the page — not a similar equation, not a paraphrase.\n"
            "Small differences in how LaTeX renders vs plain text (e.g. \\lambda vs λ, \\{ vs {) are fine.\n"
            "Return JSON only: {\"present\": bool, \"confidence\": 0..100}."
        )
        user_text = (
            "Is the following string visible on this page?\n\n"
            f"\"\"\"\n{evidence_quote}\n\"\"\"\n\n"
            "Return JSON only."
        )

        text = await self._post(
            system_text=system,
            user_text=user_text,
            image_b64=image_b64,
            max_tokens=200,
            tag="vision.presence",
        )
        return _parse_presence(text)

    # -- tiebreaker --------------------------------------------------------

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
            "Candidates (pick one index whose surrounding context matches the page):\n\n"
            + "\n\n".join(cand_lines)
            + "\n\nReturn JSON only."
        )

        text = await self._post(
            system_text=system,
            user_text=user_text,
            image_b64=image_b64,
            max_tokens=200,
            tag="vision.disambiguate",
        )
        return _parse_picked(text, len(candidates))


# ---------------------------------------------------------------------------
# Response parsers — provider-agnostic, JSON-shape only.
# ---------------------------------------------------------------------------


def _strip_fences(text: str) -> str:
    if not text or not text.startswith("```"):
        return text
    nl = text.find("\n")
    if nl >= 0:
        text = text[nl + 1 :]
    if text.rstrip().endswith("```"):
        text = text.rstrip()[:-3].rstrip()
    return text


def _parse_batch(text: str, expected_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    if not text:
        return {
            i: {
                "verified": False,
                "bbox_norm": None,
                "dropped_reason": "empty vision response",
            }
            for i in expected_ids
        }

    text = _strip_fences(text)

    try:
        arr = json.loads(text)
    except json.JSONDecodeError:
        extracted = _extract_json_value(text)
        if extracted is None:
            logger.warning(
                "vision.batch: could not parse JSON from response: %r", text[:200]
            )
            return {
                i: {
                    "verified": False,
                    "bbox_norm": None,
                    "dropped_reason": "malformed vision response",
                }
                for i in expected_ids
            }
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

    for i in expected_ids:
        if i not in out:
            out[i] = {
                "verified": False,
                "bbox_norm": None,
                "dropped_reason": "vision omitted this id",
            }
    return out


def _parse_presence(text: str) -> Dict[str, Any]:
    text = _strip_fences(text)
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


def _parse_picked(text: str, n_candidates: int) -> Dict[str, Any]:
    text = _strip_fences(text)
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
            if picked < 0 or picked >= n_candidates:
                picked = None
        except (TypeError, ValueError):
            picked = None
    try:
        conf = max(0, min(100, int(parsed.get("confidence", 0))))
    except (TypeError, ValueError):
        conf = 0
    return {"picked": picked, "confidence": conf}


def _sanitize_bbox(raw: Any) -> Optional[Dict[str, float]]:
    if not isinstance(raw, dict):
        return None
    try:
        x0, y0, x1, y1 = (
            float(raw["x0"]),
            float(raw["y0"]),
            float(raw["x1"]),
            float(raw["y1"]),
        )
    except (KeyError, TypeError, ValueError):
        return None
    x0 = max(0.0, min(1.0, x0))
    y0 = max(0.0, min(1.0, y0))
    x1 = max(0.0, min(1.0, x1))
    y1 = max(0.0, min(1.0, y1))
    if x1 <= x0 or y1 <= y0:
        return None
    return {"x0": x0, "y0": y0, "x1": x1, "y1": y1}
