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
    aws_access_key_id: str = ""
    aws_secret_access_key: str = ""

    # LLM API keys — one per provider
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    deepseek_api_key: str = ""
    moonshot_api_key: str = ""
    minimax_api_key: str = ""

    # Defaults
    default_model: str = "claude-opus-4-6"
    data_dir: str = "./data"


settings = Settings()
