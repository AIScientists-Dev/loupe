from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


_ROOT = Path(__file__).resolve().parent.parent.parent  # ProofAgent/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # MinerU PDF parser (AWS GPU)
    mineru_api_url: str = ""
    mineru_timeout_seconds: float = 600.0

    # LLM providers — cloud (set per-provider keys; only what you use needs to be filled)
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    deepseek_api_key: str = ""
    moonshot_api_key: str = ""
    minimax_api_key: str = ""

    # Local LLM endpoints (privacy-by-design path).
    #
    # Ollama: leave OLLAMA_BASE_URL empty to disable. Models are addressed
    # as `ollama:<name>` from the frontend (e.g. `ollama:llama3.1`,
    # `ollama:qwen2.5`). OLLAMA_MODELS is a comma-separated list the API
    # surfaces back to the picker; the runtime accepts any name regardless.
    ollama_base_url: str = ""
    ollama_models: str = ""

    # Generic OpenAI-compatible local endpoint — for vLLM, LM Studio,
    # llama.cpp's server, Together, Groq, Fireworks, OpenRouter, etc.
    # Models are addressed as `local:<name>` from the frontend.
    local_openai_base_url: str = ""
    local_openai_api_key: str = ""
    local_openai_models: str = ""

    # Models — Sonnet for text AND vision by default (cheap enough to stay
    # under the $0.30/paper target). Override vision_model to claude-opus-4-7
    # via env var if bbox precision ever regresses in practice.
    text_model: str = "claude-sonnet-4-6"
    vision_model: str = "claude-sonnet-4-6"

    # Data
    data_dir: str = "./data"

    # CORS — frontend dev server runs on 3009 (next dev --port 3009).
    # :3000 is deliberately excluded to avoid collisions with other repos.
    cors_origins: list[str] = [
        "http://localhost:3009",
        "http://127.0.0.1:3009",
    ]

    # Visual localize concurrency
    localize_concurrency: int = 3

    # Web_search tool inside verify_proofs. Off by default — search results
    # bring back ~5–10K extra input tokens per call, easily 3–5× the
    # verify cost. Flip to true per-paper when a paper has many
    # named-result citations that warrant external verification.
    verify_enable_web_search: bool = False

    # Hard budget cap per paper in **billed** USD (after markup). When the
    # running cost crosses this, the scheduler pauses before starting the
    # next segment, emits `run.budget_exceeded`, and waits for user input.
    # Resume bypasses the check once so the user can opt to continue past
    # the cap. Set to 0 to disable the guardrail entirely.
    max_budget_usd: float = 1.50


settings = Settings()
