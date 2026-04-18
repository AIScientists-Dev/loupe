"""Pipeline runner — parse → extract_proofs → verify_proofs.

On step failure: paper.status = failed, step = failed, error_code/error_message set;
SSE emits step.failed with retriable flag.
On success: paper.status = ready, step = ready, step_index = len(PIPELINE_ORDER).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Callable, List, Tuple

from app.models import PIPELINE_ORDER, Paper, PaperStatus, PipelineStep
from app.pipeline.steps.extract_proofs import run_extract_proofs
from app.pipeline.steps.parse import run_parse
from app.pipeline.steps.verify_proofs import run_verify_proofs
from app.services.events import bus
from app.services.llm_client import LLMClient
from app.services.mineru_client import MinerUClient
from app.services.storage import FileStore

logger = logging.getLogger(__name__)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def run_pipeline(
    paper: Paper,
    store: FileStore,
    llm: LLMClient,
    mineru: MinerUClient,
) -> Paper:
    """Execute the pipeline, saving paper state after each step and emitting SSE."""
    pid = paper.paper_id

    steps: List[Tuple[PipelineStep, Callable]] = [
        (PipelineStep.parse,           lambda: run_parse(paper, store, mineru)),
        (PipelineStep.extract_proofs,  lambda: run_extract_proofs(paper, llm, bus)),
        (PipelineStep.verify_proofs,   lambda: run_verify_proofs(paper, llm, bus)),
    ]

    for idx, (step, fn) in enumerate(steps):
        paper.step = step
        paper.step_index = idx
        paper.updated_at = _now()
        store.save_paper(paper)
        bus.emit(pid, "step.started", {"step": step.value, "step_index": idx})

        try:
            await fn()
        except Exception as exc:
            error_code, retriable = _classify(exc)
            logger.exception("Pipeline step %s failed for paper %s", step.value, pid)
            paper.status = PaperStatus.failed
            paper.step = PipelineStep.failed
            paper.error_code = error_code
            paper.error_message = str(exc)
            paper.updated_at = _now()
            store.save_paper(paper)
            bus.emit(pid, "step.failed", {
                "step": step.value,
                "error_code": error_code,
                "message": str(exc),
                "retriable": retriable,
            })
            return paper

        paper.updated_at = _now()
        store.save_paper(paper)
        bus.emit(pid, "step.completed", {"step": step.value, "step_index": idx})

    paper.status = PaperStatus.ready
    paper.step = PipelineStep.ready
    paper.step_index = len(PIPELINE_ORDER)
    paper.updated_at = _now()
    store.save_paper(paper)
    bus.emit(pid, "pipeline.done", {"status": "ready"})
    logger.info("Pipeline complete for paper %s — %d findings", pid, len(paper.findings))
    return paper


def _classify(exc: BaseException) -> Tuple[str, bool]:
    """Map an exception to (error_code, retriable). Codes locked by contract."""
    import httpx

    if isinstance(exc, FileNotFoundError):
        return "pdf_unreadable", False
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code if exc.response is not None else 0
        if status == 429:
            return "llm_rate_limited", True
        if 500 <= status < 600:
            return "mineru_unavailable" if "mineru" in str(exc).lower() else "llm_error", True
        return "llm_error", False
    if isinstance(exc, httpx.RequestError):
        return "mineru_unavailable", True
    if isinstance(exc, ValueError):
        return "llm_invalid_response", False
    return "internal", False
