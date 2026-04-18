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
                model, messages, system, temperature, max_tokens, api_key
            )
        else:
            headers, body = self._openai_payload(
                model, messages, system, temperature, max_tokens, api_key
            )

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
    ) -> Any:
        """Call complete() and parse the response as JSON."""
        raw = await self.complete(model, messages, system, temperature, max_tokens)
        # Strip markdown code fences if present
        text = raw.strip()
        if text.startswith("```"):
            lines = text.split("\n")
            lines = lines[1:]  # drop opening fence
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            text = "\n".join(lines)
        return json.loads(text)
