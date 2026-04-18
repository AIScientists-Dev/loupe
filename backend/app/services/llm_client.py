"""Model-agnostic LLM client. Zero SDK dependencies — raw httpx POST only."""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Provider endpoints
_ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
_OPENAI_URL = "https://api.openai.com/v1/chat/completions"
_DEEPSEEK_URL = "https://api.deepseek.com/v1/chat/completions"
_MOONSHOT_URL = "https://api.moonshot.cn/v1/chat/completions"
_MINIMAX_URL = "https://api.minimax.chat/v1/text/chatcompletion_v2"

# Model → (endpoint, format)  format is "anthropic" or "openai"
_ROUTING: Dict[str, tuple] = {
    "claude-sonnet-4-6": (_ANTHROPIC_URL, "anthropic"),
    "claude-opus-4-6": (_ANTHROPIC_URL, "anthropic"),
    "claude-opus-4-7": (_ANTHROPIC_URL, "anthropic"),
    "gpt-4.1": (_OPENAI_URL, "openai"),
    "deepseek-v3": (_DEEPSEEK_URL, "openai"),
    "kimi-k2.5": (_MOONSHOT_URL, "openai"),
    "minimax-m2.7": (_MINIMAX_URL, "openai"),
}

# Per-MTok USD prices: (input, cached_read, output).
# Used only for observability — logged, not enforced.
_PRICES: Dict[str, tuple] = {
    "claude-sonnet-4-6": (3.0, 0.30, 15.0),
    "claude-opus-4-6":   (15.0, 1.50, 75.0),
    "claude-opus-4-7":   (15.0, 1.50, 75.0),
}


class _UsageTracker:
    """Process-wide accumulator for token usage + estimated cost (USD)."""
    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.calls = 0
        self.input_tokens = 0
        self.cache_read_tokens = 0
        self.cache_write_tokens = 0
        self.output_tokens = 0
        self.cost_usd = 0.0
        self.by_tag: Dict[str, Dict[str, float]] = {}

    def record(
        self,
        model: str,
        usage: Dict[str, Any],
        tag: str = "",
    ) -> Dict[str, Any]:
        in_t = int(usage.get("input_tokens", 0) or 0)
        cache_write = int(usage.get("cache_creation_input_tokens", 0) or 0)
        cache_read = int(usage.get("cache_read_input_tokens", 0) or 0)
        out_t = int(usage.get("output_tokens", 0) or 0)

        price_in, price_cached, price_out = _PRICES.get(model, (0.0, 0.0, 0.0))
        cost = (
            in_t * price_in / 1_000_000
            + cache_write * price_in * 1.25 / 1_000_000     # cache-write surcharge
            + cache_read * price_cached / 1_000_000
            + out_t * price_out / 1_000_000
        )

        self.calls += 1
        self.input_tokens += in_t + cache_write
        self.cache_read_tokens += cache_read
        self.cache_write_tokens += cache_write
        self.output_tokens += out_t
        self.cost_usd += cost

        bucket = self.by_tag.setdefault(tag or "untagged", {"calls": 0, "input": 0, "cache_read": 0, "output": 0, "cost": 0.0})
        bucket["calls"] += 1
        bucket["input"] += in_t + cache_write
        bucket["cache_read"] += cache_read
        bucket["output"] += out_t
        bucket["cost"] += cost

        logger.info(
            "llm_usage tag=%s model=%s in=%d cached_write=%d cached_read=%d out=%d cost=$%.4f",
            tag or "-", model, in_t, cache_write, cache_read, out_t, cost,
        )
        return {"input": in_t, "cache_write": cache_write, "cache_read": cache_read, "output": out_t, "cost_usd": cost}

    def summary(self) -> Dict[str, Any]:
        return {
            "calls": self.calls,
            "input_tokens": self.input_tokens,
            "cache_read_tokens": self.cache_read_tokens,
            "cache_write_tokens": self.cache_write_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": round(self.cost_usd, 4),
            "by_tag": {k: {**v, "cost": round(v["cost"], 4)} for k, v in self.by_tag.items()},
        }


usage_tracker = _UsageTracker()


def _api_key_for(model: str) -> str:
    if model.startswith("claude"):
        return settings.anthropic_api_key
    if model.startswith("gpt"):
        return settings.openai_api_key
    if model.startswith("deepseek"):
        return settings.deepseek_api_key
    if model.startswith("kimi"):
        return settings.moonshot_api_key
    if model.startswith("minimax"):
        return settings.minimax_api_key
    return settings.anthropic_api_key  # fallback


class LLMClient:
    """Unified LLM caller via raw HTTP. No SDK dependencies."""

    async def complete(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        system: Optional[Any] = None,
        temperature: Optional[float] = 0.3,
        max_tokens: int = 4096,
        tools: Optional[List[Dict[str, Any]]] = None,
        tag: str = "",
    ) -> str:
        route = _ROUTING.get(model)
        if not route:
            raise ValueError(f"Unknown model: {model}")

        url, fmt = route
        api_key = _api_key_for(model)
        if not api_key:
            raise ValueError(f"No API key configured for model {model}")

        if fmt == "anthropic":
            headers, body = self._anthropic_payload(
                model, messages, system, temperature, max_tokens, api_key, tools
            )
        else:
            headers, body = self._openai_payload(
                model, messages, system, temperature, max_tokens, api_key
            )
            if tools:
                logger.warning("tools requested for non-Anthropic provider %s — ignored", model)

        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()

        if fmt == "anthropic":
            usage_tracker.record(model, data.get("usage", {}) or {}, tag=tag)
            return self._parse_anthropic(data)
        return self._parse_openai(data)

    # -- payload builders ------------------------------------------------------

    @staticmethod
    def _anthropic_payload(
        model: str,
        messages: List[Dict[str, Any]],
        system: Optional[Any],
        temperature: Optional[float],
        max_tokens: int,
        api_key: str,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> tuple:
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        body: Dict[str, Any] = {
            "model": model,
            "max_tokens": max_tokens,
            "messages": messages,
        }
        # Opus 4.7 rejects temperature; pass only when caller provided it AND
        # the model supports it.
        if temperature is not None and not model.startswith("claude-opus-4-7"):
            body["temperature"] = temperature
        if system:
            # system may be a plain string or a list of content blocks
            # (list form allows cache_control annotations).
            body["system"] = system
        if tools:
            body["tools"] = tools
        return headers, body

    @staticmethod
    def _openai_payload(
        model: str,
        messages: List[Dict[str, Any]],
        system: Optional[str],
        temperature: float,
        max_tokens: int,
        api_key: str,
    ) -> tuple:
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        all_messages = []
        if system:
            all_messages.append({"role": "system", "content": system})
        all_messages.extend(messages)
        body = {
            "model": model,
            "messages": all_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        return headers, body

    # -- response parsers ------------------------------------------------------

    @staticmethod
    def _parse_anthropic(data: Dict[str, Any]) -> str:
        content = data.get("content", [])
        # Log server-tool usage (web_search) so callers can audit trace.
        tool_uses = [b for b in content if b.get("type") == "server_tool_use"]
        if tool_uses:
            for t in tool_uses:
                logger.info(
                    "anthropic server tool used: name=%s input_keys=%s",
                    t.get("name"), list((t.get("input") or {}).keys()),
                )
            # When server tools are used, the model interleaves reasoning text
            # with tool calls. The FINAL text block holds the answer; earlier
            # text blocks are intermediate reasoning and must not be prepended
            # (callers like complete_json get confused by prose + JSON mixes).
            text_blocks = [b for b in content if b.get("type") == "text"]
            if text_blocks:
                return text_blocks[-1]["text"]
            return ""
        # No tools: concatenate all text blocks (rare to have >1).
        parts = [block["text"] for block in content if block.get("type") == "text"]
        return "".join(parts)

    @staticmethod
    def _parse_openai(data: Dict[str, Any]) -> str:
        choices = data.get("choices", [])
        if not choices:
            return ""
        return choices[0].get("message", {}).get("content", "")

    # -- helpers ---------------------------------------------------------------

    async def complete_json(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        system: Optional[Any] = None,
        temperature: Optional[float] = 0.2,
        max_tokens: int = 8192,
        tools: Optional[List[Dict[str, Any]]] = None,
        tag: str = "",
    ) -> Any:
        """Call complete() and parse the response as JSON.

        Tolerates: markdown code fences, leading/trailing prose, ``json`` tags.
        Extracts the first balanced JSON value (object or array) if direct parse fails.
        """
        raw = await self.complete(model, messages, system, temperature, max_tokens, tools=tools, tag=tag)
        text = raw.strip()

        # Strip markdown code fences.
        if text.startswith("```"):
            nl = text.find("\n")
            if nl >= 0:
                text = text[nl + 1:]
            if text.rstrip().endswith("```"):
                text = text.rstrip()[:-3].rstrip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        parsed = _extract_and_parse_json(text)
        if parsed is None:
            raise ValueError(f"LLM response was not parseable as JSON: {text[:400]!r}")
        return parsed


def _extract_json_value(text: str) -> Optional[str]:
    """Return the first balanced JSON array or object substring in `text`, or None."""
    open_chars = {"[": "]", "{": "}"}
    for i, ch in enumerate(text):
        if ch in open_chars:
            end = _match_balanced(text, i, ch, open_chars[ch])
            if end >= 0:
                return text[i:end + 1]
    return None


def _extract_and_parse_json(text: str) -> Optional[Any]:
    """Find the best balanced JSON substring in `text` that actually parses.

    Strategy: collect all `[...]` and `{...}` candidate substrings, try arrays
    first (we almost always prompt for arrays), from longest to shortest. Skip
    candidates that json.loads can't parse. Return the parsed value or None.
    """
    candidates_arr: List[str] = []
    candidates_obj: List[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if ch == "[":
            end = _match_balanced(text, i, "[", "]")
            if end >= 0:
                candidates_arr.append(text[i:end + 1])
                i = end + 1
                continue
        elif ch == "{":
            end = _match_balanced(text, i, "{", "}")
            if end >= 0:
                candidates_obj.append(text[i:end + 1])
                i = end + 1
                continue
        i += 1

    for cand in sorted(candidates_arr, key=len, reverse=True):
        try:
            return json.loads(cand)
        except json.JSONDecodeError:
            continue
    for cand in sorted(candidates_obj, key=len, reverse=True):
        try:
            return json.loads(cand)
        except json.JSONDecodeError:
            continue
    return None


def _match_balanced(text: str, start: int, open_ch: str, close_ch: str) -> int:
    """Walk text from `start` respecting JSON strings + escapes. Return close index or -1."""
    depth = 0
    in_string = False
    escape = False
    for i in range(start, len(text)):
        c = text[i]
        if in_string:
            if escape:
                escape = False
            elif c == "\\":
                escape = True
            elif c == '"':
                in_string = False
            continue
        if c == '"':
            in_string = True
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i
    return -1
