"""Thin coordination layer: paper CRUD + pipeline dispatch."""
from __future__ import annotations

import logging
from typing import List, Optional

from app.models import Paper, PaperStatus, PaperSummary, PipelineStep
from app.pipeline.runner import run_pipeline
from app.services.llm_client import LLMClient
from app.services.mineru_client import MinerUClient
from app.services.storage import FileStore

logger = logging.getLogger(__name__)


class Orchestrator:
    def __init__(self, store: FileStore, llm: LLMClient, mineru: MinerUClient) -> None:
        self.store = store
        self.llm = llm
        self.mineru = mineru

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
        return self.store.delete_paper(paper_id)

    # -- pipeline dispatch ----------------------------------------------------

    async def run_pipeline_task(self, paper_id: str) -> None:
        """Background task entrypoint — reload paper fresh and run."""
        paper = self.store.load_paper(paper_id)
        if not paper:
            logger.warning("run_pipeline_task: paper %s disappeared", paper_id)
            return
        try:
            await run_pipeline(paper, self.store, self.llm, self.mineru)
        except Exception:
            # run_pipeline already handled persistence + SSE emission.
            logger.exception("Unhandled error in pipeline task for %s", paper_id)
