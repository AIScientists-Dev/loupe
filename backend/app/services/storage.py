from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import List

from app.config import settings
from app.models import Paper, PaperSummary


class FileStore:
    """JSON file store with atomic writes. Single anonymous user."""

    def __init__(self, data_dir: str | None = None) -> None:
        base = Path(data_dir or settings.data_dir)
        self.base = base
        self.papers_dir = base / "papers"
        self.pdfs_dir = base / "pdfs"
        for d in (self.papers_dir, self.pdfs_dir):
            d.mkdir(parents=True, exist_ok=True)

    # -- atomic write helper --------------------------------------------------

    @staticmethod
    def _atomic_write(path: Path, payload: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=str(path.parent), prefix=".tmp-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
            os.replace(tmp, path)  # atomic on POSIX
        except Exception:
            Path(tmp).unlink(missing_ok=True)
            raise

    # -- papers ---------------------------------------------------------------

    def save_paper(self, paper: Paper) -> None:
        payload = json.dumps(paper.model_dump(mode="json"), ensure_ascii=False, indent=2)
        self._atomic_write(self.papers_dir / f"{paper.paper_id}.json", payload)

    def load_paper(self, paper_id: str) -> Paper | None:
        path = self.papers_dir / f"{paper_id}.json"
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        return Paper(**data)

    def list_papers(self) -> List[PaperSummary]:
        results: List[PaperSummary] = []
        for p in sorted(self.papers_dir.glob("*.json"), key=lambda f: f.stat().st_mtime, reverse=True):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            findings = data.get("findings", [])
            active = [f for f in findings if not f.get("soft_deleted", False)]
            decided = sum(1 for f in active if f.get("decision") is not None)
            results.append(PaperSummary(
                paper_id=data["paper_id"],
                filename=data["filename"],
                title=data.get("title"),
                status=data["status"],
                step=data["step"],
                step_index=data.get("step_index", 0),
                finding_count=len(active),
                decided_count=decided,
                created_at=data["created_at"],
            ))
        return results

    def delete_paper(self, paper_id: str) -> bool:
        paper_file = self.papers_dir / f"{paper_id}.json"
        pdf_file = self.pdfs_dir / f"{paper_id}.pdf"
        existed = paper_file.exists()
        paper_file.unlink(missing_ok=True)
        pdf_file.unlink(missing_ok=True)
        return existed

    # -- PDFs -----------------------------------------------------------------

    def save_pdf(self, paper_id: str, pdf_bytes: bytes) -> Path:
        path = self.pdfs_dir / f"{paper_id}.pdf"
        fd, tmp = tempfile.mkstemp(dir=str(self.pdfs_dir), prefix=".tmp-", suffix=".pdf")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(pdf_bytes)
            os.replace(tmp, path)
        except Exception:
            Path(tmp).unlink(missing_ok=True)
            raise
        return path

    def load_pdf(self, paper_id: str) -> bytes | None:
        path = self.pdfs_dir / f"{paper_id}.pdf"
        return path.read_bytes() if path.exists() else None

    def pdf_path(self, paper_id: str) -> Path | None:
        path = self.pdfs_dir / f"{paper_id}.pdf"
        return path if path.exists() else None
