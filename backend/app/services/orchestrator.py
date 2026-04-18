"""Thin coordination layer: paper CRUD + pipeline dispatch + localize + decide/investigate."""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

from app.config import settings
from app.models import (
    Finding,
    FindingDecision,
    LocalizeStatus,
    Paper,
    PaperStatus,
    PaperSummary,
    PipelineStep,
)
from app.pipeline.runner import run_pipeline
from app.pipeline.steps.localize import localize_finding
from app.services.events import bus
from app.services.llm_client import LLMClient
from app.services.mineru_client import MinerUClient
from app.services.storage import FileStore
from app.services.vision_client import VisionClient

logger = logging.getLogger(__name__)


class Orchestrator:
    def __init__(
        self,
        store: FileStore,
        llm: LLMClient,
        mineru: MinerUClient,
        vision: VisionClient,
    ) -> None:
        self.store = store
        self.llm = llm
        self.mineru = mineru
        self.vision = vision
        # Per-paper lock so we don't clobber findings while user mutates them.
        self._locks: dict[str, asyncio.Lock] = {}

    def _lock(self, paper_id: str) -> asyncio.Lock:
        lk = self._locks.get(paper_id)
        if lk is None:
            lk = asyncio.Lock()
            self._locks[paper_id] = lk
        return lk

    # -- paper CRUD -----------------------------------------------------------

    def create_paper(self, filename: str, pdf_bytes: bytes) -> Paper:
        paper = Paper(
            filename=filename,
            status=PaperStatus.analyzing,
            step=PipelineStep.parse,
            step_index=0,
        )
        self.store.save_pdf(paper.paper_id, pdf_bytes)
        self.store.save_paper(paper)
        return paper

    def get_paper(self, paper_id: str) -> Optional[Paper]:
        return self.store.load_paper(paper_id)

    def list_papers(self) -> List[PaperSummary]:
        return self.store.list_papers()

    def delete_paper(self, paper_id: str) -> bool:
        ok = self.store.delete_paper(paper_id)
        self._locks.pop(paper_id, None)
        return ok

    # -- pipeline dispatch ----------------------------------------------------

    async def run_pipeline_task(self, paper_id: str) -> None:
        paper = self.store.load_paper(paper_id)
        if not paper:
            logger.warning("run_pipeline_task: paper %s disappeared", paper_id)
            return
        try:
            await run_pipeline(paper, self.store, self.llm, self.mineru)
        except Exception:
            logger.exception("Unhandled error in pipeline task for %s", paper_id)

        paper = self.store.load_paper(paper_id)
        if paper and paper.status == PaperStatus.ready and paper.findings:
            asyncio.create_task(self.localize_all(paper_id))

    # -- localize -------------------------------------------------------------

    async def localize_one(self, paper_id: str, finding_id: str) -> Optional[Finding]:
        async with self._lock(paper_id):
            paper = self.store.load_paper(paper_id)
            if not paper:
                return None
            finding = paper.finding(finding_id)
            if not finding:
                return None
            await localize_finding(paper, finding, self.store, self.vision)
            paper.updated_at = _now()
            self.store.save_paper(paper)
            bus.emit(paper_id, "localize.completed", {
                "finding_id": finding.finding_id,
                "localize_status": finding.localize_status.value,
            })
            return finding

    async def localize_all(self, paper_id: str) -> None:
        """Fan out localize across all pending findings with bounded concurrency."""
        paper = self.store.load_paper(paper_id)
        if not paper:
            return
        pending_ids = [
            f.finding_id
            for f in paper.findings
            if f.localize_status == LocalizeStatus.pending and not f.soft_deleted
        ]
        if not pending_ids:
            return

        sem = asyncio.Semaphore(max(1, settings.localize_concurrency))

        async def _one(fid: str) -> None:
            async with sem:
                try:
                    await self.localize_one(paper_id, fid)
                except Exception:
                    logger.exception("localize_all: finding %s failed", fid)

        await asyncio.gather(*(_one(fid) for fid in pending_ids))

        # Signal fan-out done.
        bus.emit(paper_id, "pipeline.done", {"status": "ready", "phase": "localize"})


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
