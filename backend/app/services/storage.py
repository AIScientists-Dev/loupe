from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.config import settings
from app.models import Paper, PaperSummaryResponse, UserProfile


class FileStore:
    def __init__(self, data_dir: str | None = None) -> None:
        base = Path(data_dir or settings.data_dir)
        self.base = base
        self.papers_dir = base / "papers"
        self.pdfs_dir = base / "pdfs"
        self.profiles_dir = base / "profiles"
        for d in (self.papers_dir, self.pdfs_dir, self.profiles_dir):
            d.mkdir(parents=True, exist_ok=True)

    # -- helpers ---------------------------------------------------------------

    def _write(self, path: Path, payload: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def _read(self, path: Path) -> Any | None:
        if not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    # -- papers ----------------------------------------------------------------

    def save_paper(self, paper: Paper) -> None:
        self._write(self.papers_dir / f"{paper.paper_id}.json", paper.model_dump())

    def load_paper(self, paper_id: str) -> Paper | None:
        data = self._read(self.papers_dir / f"{paper_id}.json")
        return Paper(**data) if data else None

    def list_papers(self, user_id: str) -> list[PaperSummaryResponse]:
        results: list[PaperSummaryResponse] = []
        for p in sorted(self.papers_dir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
            data = self._read(p)
            if data and data.get("user_id") == user_id:
                findings = data.get("findings", [])
                reviewed = sum(1 for f in findings if f.get("decision") is not None)
                results.append(PaperSummaryResponse(
                    paper_id=data["paper_id"],
                    filename=data["filename"],
                    title=data.get("title"),
                    status=data["status"],
                    finding_count=len(findings),
                    reviewed_count=reviewed,
                    created_at=data["created_at"],
                ))
        return results

    def delete_paper(self, paper_id: str) -> bool:
        paper_file = self.papers_dir / f"{paper_id}.json"
        pdf_file = self.pdfs_dir / f"{paper_id}.pdf"
        deleted = False
        if paper_file.exists():
            paper_file.unlink()
            deleted = True
        if pdf_file.exists():
            pdf_file.unlink()
        return deleted

    # -- PDFs ------------------------------------------------------------------

    def save_pdf(self, paper_id: str, pdf_bytes: bytes) -> Path:
        path = self.pdfs_dir / f"{paper_id}.pdf"
        path.write_bytes(pdf_bytes)
        return path

    def load_pdf(self, paper_id: str) -> bytes | None:
        path = self.pdfs_dir / f"{paper_id}.pdf"
        return path.read_bytes() if path.exists() else None

    # -- profiles --------------------------------------------------------------

    def save_profile(self, profile: UserProfile) -> None:
        self._write(self.profiles_dir / f"{profile.user_id}.json", profile.model_dump())

    def load_profile(self, user_id: str) -> UserProfile | None:
        data = self._read(self.profiles_dir / f"{user_id}.json")
        return UserProfile(**data) if data else None
