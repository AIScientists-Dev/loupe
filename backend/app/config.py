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

    # LLM providers
    anthropic_api_key: str = ""

    # Models — Sonnet for text, Opus for vision
    text_model: str = "claude-sonnet-4-6"
    vision_model: str = "claude-opus-4-7"

    # Data
    data_dir: str = "./data"

    # CORS — whitelist the frontend localhost only
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

    # Visual localize concurrency
    localize_concurrency: int = 3


settings = Settings()
