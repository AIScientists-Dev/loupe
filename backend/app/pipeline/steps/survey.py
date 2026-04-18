"""Step 2: SURVEY — LLM reads full paper, produces structured summary."""
from __future__ import annotations

import json

from app.models import Paper, PaperStatus, UserProfile
from app.pipeline.prompts.sections import build_survey_prompt
from app.services.llm_client import LLMClient


async def run_survey(paper: Paper, profile: UserProfile, llm: LLMClient) -> Paper:
    prompt = build_survey_prompt(
        paper.parsed_blocks, profile.focus_areas, profile.learned_rules
    )
    response = await llm.complete_json(
        model=paper.model.value,
        messages=[{"role": "user", "content": prompt}],
    )
    paper.survey_summary = json.dumps(response, ensure_ascii=False)
    paper.status = PaperStatus.analyzing
    return paper
