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
# Hardcoded routes for known cloud models. Local + custom providers are
# resolved dynamically below via prefix (ollama:* and local:*).
_ROUTING: Dict[str, tuple] = {
    # Anthropic (Messages API)
    "claude-opus-4-7":     (_ANTHROPIC_URL, "anthropic"),
    "claude-sonnet-4-6":   (_ANTHROPIC_URL, "anthropic"),
    "claude-haiku-4-5":    (_ANTHROPIC_URL, "anthropic"),
    "claude-opus-4-6":     (_ANTHROPIC_URL, "anthropic"),  # legacy
    # OpenAI (Chat Completions)
    "gpt-5":               (_OPENAI_URL, "openai"),
    "gpt-5-mini":          (_OPENAI_URL, "openai"),
    "gpt-4o":              (_OPENAI_URL, "openai"),
    "gpt-4o-mini":         (_OPENAI_URL, "openai"),
    "gpt-4.1":             (_OPENAI_URL, "openai"),
    # DeepSeek (OpenAI-compatible)
    "deepseek-chat":       (_DEEPSEEK_URL, "openai"),
    "deepseek-reasoner":   (_DEEPSEEK_URL, "openai"),
    "deepseek-v3":         (_DEEPSEEK_URL, "openai"),     # legacy alias
    # Moonshot / Kimi (OpenAI-compatible)
    "moonshot-v1-8k":      (_MOONSHOT_URL, "openai"),
    "moonshot-v1-32k":     (_MOONSHOT_URL, "openai"),
    "moonshot-v1-128k":    (_MOONSHOT_URL, "openai"),
    "kimi-k2.5":           (_MOONSHOT_URL, "openai"),     # legacy alias
    # MiniMax (OpenAI-compatible v2 endpoint)
    "MiniMax-Text-01":     (_MINIMAX_URL, "openai"),
    "minimax-m2.7":        (_MINIMAX_URL, "openai"),      # legacy alias
}


def _resolve_route(model: str) -> Optional[tuple]:
    """Return (url, fmt) for a model, supporting local-LLM prefixes.

    Privacy-by-design path: any model name prefixed `ollama:` or `local:`
    is routed to a self-hosted endpoint configured via env vars. The
    paper's content never leaves the user's machine in those modes.
    """
    if model in _ROUTING:
        return _ROUTING[model]
    if model.startswith("ollama:"):
        # Ollama exposes an OpenAI-compatible endpoint at /v1/chat/completions.
        base = (settings.ollama_base_url or "").rstrip("/")
        if not base:
            return None
        return (f"{base}/v1/chat/completions", "openai_local")
    if model.startswith("local:"):
        base = (settings.local_openai_base_url or "").rstrip("/")
        if not base:
            return None
        # Caller may either configure a base ending in /v1 or not — accept both.
        suffix = "" if base.endswith("/chat/completions") else "/chat/completions"
        if not base.endswith("/v1") and "/v1/" not in base and not base.endswith("/v1/chat/completions"):
            base = f"{base}/v1"
        return (f"{base}{suffix}", "openai_local")
    return None

# Pricing lives in app/services/pricing.py — a single open file so users
# can audit every number. LLMClient only observes + records.
from app.services.pricing import llm_cost as _compute_llm_cost  # noqa: E402


class _UsageTracker:
    """Process-wide accumulator for token usage + estimated cost (USD).

    The paper-level accumulator lives on the Paper model (persisted).
    This one is an ephemeral counter for ad-hoc scripts and logs.
    """
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

        cost = _compute_llm_cost(model, in_t, cache_write, cache_read, out_t)

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
    if model.startswith("gpt") or model.startswith("o1") or model.startswith("o3") or model.startswith("o4"):
        return settings.openai_api_key
    if model.startswith("deepseek"):
        return settings.deepseek_api_key
    if model.startswith("kimi") or model.startswith("moonshot"):
        return settings.moonshot_api_key
    if model.startswith("minimax") or model.startswith("MiniMax"):
        return settings.minimax_api_key
    # Local providers: Ollama runs without auth; custom OpenAI-compatible
    # endpoints may or may not require a key (vLLM, Together, Groq vary).
    # An empty key is OK — the request just goes out without Authorization.
    if model.startswith("ollama:"):
        return ""
    if model.startswith("local:"):
        return settings.local_openai_api_key
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
        route = _resolve_route(model)
        if not route:
            raise ValueError(
                f"Unknown model: {model!r}. Cloud models must be one of "
                f"{sorted(_ROUTING)}; local models use 'ollama:<name>' "
                f"(needs OLLAMA_BASE_URL) or 'local:<name>' (needs LOCAL_OPENAI_BASE_URL)."
            )

        url, fmt = route
        api_key = _api_key_for(model)
        # Local providers may run without authentication. Cloud providers
        # always need a key — surface a clear error early.
        is_local = fmt == "openai_local"
        if not api_key and not is_local:
            raise ValueError(f"No API key configured for model {model}")

        # The "openai_local" format reuses the OpenAI payload builder.
        api_format = "anthropic" if fmt == "anthropic" else "openai"

        if api_format == "anthropic":
            headers, body = self._anthropic_payload(
                model, messages, system, temperature, max_tokens, api_key, tools
            )
        else:
            # For local providers, strip the prefix before sending — Ollama
            # and most OpenAI-compat servers expect the bare model name.
            wire_model = model.split(":", 1)[1] if is_local and ":" in model else model
            headers, body = self._openai_payload(
                wire_model, messages, system, temperature, max_tokens, api_key
            )
            if not api_key:
                # Local Ollama without auth — drop the Authorization header.
                headers.pop("Authorization", None)
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

    @staticmethod
    def is_local(model: str) -> bool:
        """True when the model routes to a self-hosted endpoint. Used by
        callers that want to surface a privacy reassurance in the UI."""
        return model.startswith("ollama:") or model.startswith("local:")

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
