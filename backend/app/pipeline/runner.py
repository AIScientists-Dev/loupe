"""5-step analysis pipeline runner."""
from __future__ import annotations

import logging
import traceback

from app.models import Paper, PaperStatus, PipelineStep, UserProfile, utc_now_iso
from app.pipeline.steps.parse import run_parse
from app.pipeline.steps.survey import run_survey
from app.pipeline.steps.examine import run_examine
from app.pipeline.steps.compare import run_compare
from app.pipeline.steps.verdict import run_verdict
from app.services.llm_client import LLMClient
from app.services.mineru_client import MinerUClient
from app.services.storage import FileStore

logger = logging.getLogger(__name__)


async def run_pipeline(
    paper: Paper,
    profile: UserProfile,
    llm: LLMClient,
    mineru: MinerUClient,
    store: FileStore,
    skip_parse: bool = False,
) -> Paper:
    """Execute the 5-step analysis pipeline, saving state after each step."""
    paper.pipeline_state.started_at = utc_now_iso()
    paper.pipeline_state.error = None

    steps = [
        (PipelineStep.parse, lambda p: run_parse(p, profile, mineru, store)),
        (PipelineStep.survey, lambda p: run_survey(p, profile, llm)),
        (PipelineStep.examine, lambda p: run_examine(p, profile, llm)),
        (PipelineStep.compare, lambda p: run_compare(p, profile, llm)),
        (PipelineStep.verdict, lambda p: run_verdict(p, profile, llm)),
    ]

    for step_name, step_fn in steps:
        if skip_parse and step_name == PipelineStep.parse:
            continue

        try:
            paper.pipeline_state.current_step = step_name
            store.save_paper(paper)
            logger.info("Running step %s for paper %s", step_name.value, paper.paper_id)

            paper = await step_fn(paper)

            paper.pipeline_state.completed_steps.append(step_name)
            store.save_paper(paper)
        except Exception as exc:
            logger.error("Pipeline step %s failed: %s", step_name.value, exc)
            paper.pipeline_state.error = f"{step_name.value}: {exc}"
            paper.status = PaperStatus.error
            store.save_paper(paper)
            raise

    paper.pipeline_state.current_step = None
    paper.pipeline_state.finished_at = utc_now_iso()
    paper.status = PaperStatus.ready
    paper.updated_at = utc_now_iso()
    store.save_paper(paper)
    logger.info("Pipeline complete for paper %s — %d findings", paper.paper_id, len(paper.findings))
    return paper
