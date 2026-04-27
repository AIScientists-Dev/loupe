"""Tiny JSON-backed folder store for v3.

Folders live at `data/folders.json` as a list of Folder rows. Atomic writes
via tempfile + os.replace, same pattern as FileStore. Single-process locking
is enough for the MVP — when we move to a multi-process deploy we'll swap
this for a real database row.

The store is intentionally dumb: no cascade onto papers. The orchestrator
is responsible for updating `paper.folder` when a folder is renamed or
deleted (so we don't depend on FileStore from here).
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import List, Optional

from app.models import Folder, VenueType


# Seeded on first boot so the library has something to show before
# onboarding completes. Per the v3 spec these come up as `is_default=True`,
# which makes them rename-only (delete is refused). The "All" folder is a
# pure UI filter — never appears in this list.
_SEED_FOLDERS: List[Folder] = [
    Folder(name="Journal", venue_type=VenueType.journal, is_default=True),
    Folder(name="Conference", venue_type=VenueType.conference, is_default=True),
    Folder(name="Grant", venue_type=VenueType.grant, is_default=True),
    Folder(name="Thesis", venue_type=VenueType.thesis, is_default=True),
]


class FolderStore:
    def __init__(self, data_dir: Path) -> None:
        self.path = data_dir / "folders.json"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        if not self.path.exists():
            self._write([f.model_dump(mode="json") for f in _SEED_FOLDERS])

    # -- read --------------------------------------------------------------

    def list(self) -> List[Folder]:
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        out: List[Folder] = []
        for row in raw:
            try:
                out.append(Folder.model_validate(row))
            except Exception:
                continue
        return out

    def get(self, name: str) -> Optional[Folder]:
        for f in self.list():
            if f.name == name:
                return f
        return None

    # -- write -------------------------------------------------------------

    def create(self, name: str, venue_type: Optional[VenueType] = None) -> Optional[Folder]:
        """Returns the new Folder, or None on duplicate name."""
        with self._lock:
            rows = self.list()
            if any(r.name == name for r in rows):
                return None
            new_row = Folder(name=name, venue_type=venue_type, is_default=False)
            rows.append(new_row)
            self._write([r.model_dump(mode="json") for r in rows])
            return new_row

    def rename(self, old: str, new: str) -> Optional[Folder]:
        """Returns the renamed Folder, or None on 404 / collision."""
        if old == new:
            return self.get(old)
        with self._lock:
            rows = self.list()
            target = next((r for r in rows if r.name == old), None)
            if target is None:
                return None
            if any(r.name == new for r in rows):
                return None  # collision
            target.name = new
            self._write([r.model_dump(mode="json") for r in rows])
            return target

    def update_venue_type(self, name: str, venue_type: Optional[VenueType]) -> Optional[Folder]:
        with self._lock:
            rows = self.list()
            target = next((r for r in rows if r.name == name), None)
            if target is None:
                return None
            target.venue_type = venue_type
            self._write([r.model_dump(mode="json") for r in rows])
            return target

    def delete(self, name: str) -> Optional[Folder]:
        """Returns the deleted Folder, or None on 404. Caller must check
        `.is_default` BEFORE calling — store doesn't refuse defaults
        itself (the route does, so the orchestrator can compose deletes
        in batch ops without re-checking the rule per row)."""
        with self._lock:
            rows = self.list()
            target = next((r for r in rows if r.name == name), None)
            if target is None:
                return None
            rows = [r for r in rows if r.name != name]
            self._write([r.model_dump(mode="json") for r in rows])
            return target

    # -- helpers -----------------------------------------------------------

    def _write(self, payload: list) -> None:
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent), prefix=".tmp-folders-", suffix=".json")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(payload, fh, indent=2, ensure_ascii=False)
            os.replace(tmp, self.path)
        except Exception:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise
