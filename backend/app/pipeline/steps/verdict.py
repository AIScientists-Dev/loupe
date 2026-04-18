"""Step 5: VERDICT — Final binary YES/NO filter on all preliminary findings."""
from __future__ import annotations

from app.models import Paper, UserProfile
from app.pipeline.prompts.sections import build_verdict_prompt
from app.services.llm_client import LLMClient


async def run_verdict(paper: Paper, profile: UserProfile, llm: LLMClient) -> Paper:
    if not paper.findings:
        return paper

    prompt = build_verdict_prompt(
        paper.findings,
        paper.parsed_blocks,
        paper.survey_summary or "",
        profile.focus_areas,
        profile.learned_rules,
    )
    raw = await llm.complete_json(
        model=paper.model.value,
        messages=[{"role": "user", "content": prompt}],
    )

    if not isinstance(raw, list):
        return paper

    # Build set of finding_ids that passed the verdict
    kept_ids = {item["finding_id"] for item in raw if item.get("finding_id")}

    # Update findings: keep only those that passed, update their labels/reasoning
    refined = {item["finding_id"]: item for item in raw if item.get("finding_id")}
    surviving = []
    for f in paper.findings:
        if f.finding_id in kept_ids:
            update = refined.get(f.finding_id, {})
            if update.get("label"):
                f.label = update["label"]
            if update.get("reasoning"):
                f.reasoning = update["reasoning"]
            surviving.append(f)

    paper.findings = surviving
    return paper
