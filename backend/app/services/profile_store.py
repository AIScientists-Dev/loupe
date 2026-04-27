"""Tiny JSON-backed onboarding-profile store for v3.

Single-user MVP: one record at `data/profile.json`. We track whether folder
seeding has run via a sibling flag file (`profile.seeded`) so a re-POST
doesn't duplicate folders the user may have since renamed/deleted.

When auth lands, swap this for a per-user table.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import Optional

from app.models import OnboardingProfile


class ProfileStore:
    def __init__(self, data_dir: Path) -> None:
        data_dir.mkdir(parents=True, exist_ok=True)
        self.path = data_dir / "profile.json"
        self.seeded_marker = data_dir / "profile.seeded"
        self._lock = Lock()

    def get(self) -> Optional[OnboardingProfile]:
        if not self.path.exists():
            return None
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
            return OnboardingProfile.model_validate(raw)
        except (OSError, json.JSONDecodeError, ValueError):
            return None

    def save(self, profile: OnboardingProfile) -> OnboardingProfile:
        with self._lock:
            self._atomic_write(profile.model_dump(mode="json"))
        return profile

    def has_seeded_folders(self) -> bool:
        return self.seeded_marker.exists()

    def mark_folders_seeded(self) -> None:
        # Empty file — its existence is the signal.
        self.seeded_marker.touch()

    def _atomic_write(self, payload: dict) -> None:
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent), prefix=".tmp-profile-", suffix=".json")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(payload, fh, indent=2, ensure_ascii=False)
            os.replace(tmp, self.path)
        except Exception:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
