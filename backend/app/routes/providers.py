"""Providers endpoint — what LLM providers are actually usable right now.

Drives the frontend grouped model picker. Returns one entry per cloud
provider (with `configured: bool` based on whether the API key is set)
plus the local endpoints if their base URLs are configured. The
frontend renders only what's reachable so users don't pick a model
the backend can't actually call.
"""
from __future__ import annotations

from typing import List, Optional

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from app.config import settings

router = APIRouter(prefix="/v1", tags=["providers"])


class ProviderModel(BaseModel):
    """One model entry inside a provider group."""
    id: str             # the wire identifier sent back to /complete
    label: str          # human-readable name for the picker
    note: Optional[str] = None


class ProviderGroup(BaseModel):
    id: str             # "anthropic" | "openai" | "china" | "ollama" | "local"
    label: str          # group title in the UI
    kind: str           # "cloud" | "local"
    configured: bool    # ready to use right now (key set / endpoint reachable)
    privacy: str        # one-line privacy posture for the UI
    models: List[ProviderModel]
    hint: Optional[str] = None  # e.g. "Set ANTHROPIC_API_KEY in .env"


def _split(csv: str) -> List[str]:
    return [s.strip() for s in (csv or "").split(",") if s.strip()]


async def _ollama_reachable() -> bool:
    base = (settings.ollama_base_url or "").rstrip("/")
    if not base:
        return False
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(f"{base}/api/tags")
            return resp.status_code == 200
    except Exception:
        return False


@router.get("/providers", response_model=List[ProviderGroup])
async def list_providers() -> List[ProviderGroup]:
    groups: List[ProviderGroup] = []

    # --- Anthropic ---------------------------------------------------------
    groups.append(ProviderGroup(
        id="anthropic",
        label="Anthropic (Claude)",
        kind="cloud",
        configured=bool(settings.anthropic_api_key),
        privacy="Sends paper text to Anthropic.",
        hint=None if settings.anthropic_api_key else "Set ANTHROPIC_API_KEY in .env",
        models=[
            ProviderModel(id="claude-opus-4-7",   label="Claude Opus 4.7",   note="highest quality"),
            ProviderModel(id="claude-sonnet-4-6", label="Claude Sonnet 4.6", note="default — fast, balanced"),
            ProviderModel(id="claude-haiku-4-5",  label="Claude Haiku 4.5",  note="cheapest"),
        ],
    ))

    # --- OpenAI ------------------------------------------------------------
    groups.append(ProviderGroup(
        id="openai",
        label="OpenAI (GPT)",
        kind="cloud",
        configured=bool(settings.openai_api_key),
        privacy="Sends paper text to OpenAI.",
        hint=None if settings.openai_api_key else "Set OPENAI_API_KEY in .env",
        models=[
            ProviderModel(id="gpt-5",       label="GPT-5",       note="flagship"),
            ProviderModel(id="gpt-5-mini",  label="GPT-5 mini",  note="fast, cheap"),
            ProviderModel(id="gpt-4o",      label="GPT-4o",      note="multimodal"),
            ProviderModel(id="gpt-4o-mini", label="GPT-4o mini", note="cheapest"),
            ProviderModel(id="gpt-4.1",     label="GPT-4.1"),
        ],
    ))

    # --- DeepSeek ----------------------------------------------------------
    groups.append(ProviderGroup(
        id="deepseek",
        label="DeepSeek",
        kind="cloud",
        configured=bool(settings.deepseek_api_key),
        privacy="Sends paper text to DeepSeek.",
        hint=None if settings.deepseek_api_key else "Set DEEPSEEK_API_KEY in .env",
        models=[
            ProviderModel(id="deepseek-chat",     label="DeepSeek V3.2", note="cheap, capable"),
            ProviderModel(id="deepseek-reasoner", label="DeepSeek R1",   note="reasoning"),
        ],
    ))

    # --- Moonshot (Kimi) ---------------------------------------------------
    groups.append(ProviderGroup(
        id="moonshot",
        label="Moonshot (Kimi)",
        kind="cloud",
        configured=bool(settings.moonshot_api_key),
        privacy="Sends paper text to Moonshot.",
        hint=None if settings.moonshot_api_key else "Set MOONSHOT_API_KEY in .env",
        models=[
            ProviderModel(id="moonshot-v1-128k", label="Kimi K2.5 (128k)", note="long context"),
            ProviderModel(id="moonshot-v1-32k",  label="Kimi K2.5 (32k)"),
        ],
    ))

    # --- MiniMax -----------------------------------------------------------
    groups.append(ProviderGroup(
        id="minimax",
        label="MiniMax",
        kind="cloud",
        configured=bool(settings.minimax_api_key),
        privacy="Sends paper text to MiniMax.",
        hint=None if settings.minimax_api_key else "Set MINIMAX_API_KEY in .env",
        models=[
            ProviderModel(id="MiniMax-Text-01", label="MiniMax Text-01"),
        ],
    ))

    # --- Ollama (local) ----------------------------------------------------
    ollama_listed = _split(settings.ollama_models)
    ollama_models = [
        ProviderModel(id=f"ollama:{name}", label=name)
        for name in ollama_listed
    ]
    groups.append(ProviderGroup(
        id="ollama",
        label="Ollama (local)",
        kind="local",
        configured=bool(settings.ollama_base_url) and await _ollama_reachable(),
        privacy="Your paper never leaves your machine.",
        hint=(
            None
            if settings.ollama_base_url
            else "Install Ollama, pull a model, set OLLAMA_BASE_URL=http://localhost:11434 in .env"
        ),
        models=ollama_models or [
            ProviderModel(id="ollama:llama3.1", label="llama3.1", note="example"),
            ProviderModel(id="ollama:qwen2.5", label="qwen2.5", note="example"),
        ],
    ))

    # --- Custom OpenAI-compatible local endpoint ---------------------------
    local_listed = _split(settings.local_openai_models)
    local_models = [
        ProviderModel(id=f"local:{name}", label=name)
        for name in local_listed
    ]
    groups.append(ProviderGroup(
        id="local",
        label="Custom OpenAI-compatible (local)",
        kind="local",
        configured=bool(settings.local_openai_base_url),
        privacy="Goes only to the endpoint you configured (vLLM, LM Studio, llama.cpp, your private gateway, …).",
        hint=(
            None
            if settings.local_openai_base_url
            else "Set LOCAL_OPENAI_BASE_URL (and LOCAL_OPENAI_MODELS) in .env"
        ),
        models=local_models,
    ))

    return groups
