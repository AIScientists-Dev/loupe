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
    "gpt-4.1": (_OPENAI_URL, "openai"),
    "deepseek-v3": (_DEEPSEEK_URL, "openai"),
    "kimi-k2.5": (_MOONSHOT_URL, "openai"),
    "minimax-m2.7": (_MINIMAX_URL, "openai"),
}


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
        system: Optional[str] = None,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        tools: Optional[List[Dict[str, Any]]] = None,
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
            return self._parse_anthropic(data)
        return self._parse_openai(data)

    # -- payload builders ------------------------------------------------------

    @staticmethod
    def _anthropic_payload(
        model: str,
        messages: List[Dict[str, Any]],
        system: Optional[str],
        temperature: float,
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
            "temperature": temperature,
            "messages": messages,
        }
        if system:
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
        system: Optional[str] = None,
        temperature: float = 0.2,
        max_tokens: int = 8192,
        tools: Optional[List[Dict[str, Any]]] = None,
    ) -> Any:
        """Call complete() and parse the response as JSON.

        Tolerates: markdown code fences, leading/trailing prose, ``json`` tags.
        Extracts the first balanced JSON value (object or array) if direct parse fails.
        """
        raw = await self.complete(model, messages, system, temperature, max_tokens, tools=tools)
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
