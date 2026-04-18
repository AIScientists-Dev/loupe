"""Step 4: COMPARE — LLM checks novelty claims against cited related work."""
from __future__ import annotations

from typing import List

from app.models import BoundingBox, Finding, Paper, PipelineStep, UserProfile
from app.pipeline.prompts.sections import build_compare_prompt
from app.services.llm_client import LLMClient


async def run_compare(paper: Paper, profile: UserProfile, llm: LLMClient) -> Paper:
    prompt = build_compare_prompt(
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
        raw = []

    findings: List[Finding] = []
    for item in raw:
        bbox_data = item.get("bbox", {})
        block_id = item.get("block_id", "")
        source_block = next((b for b in paper.parsed_blocks if b.block_id == block_id), None)
        if source_block:
            fb = source_block.bbox
        else:
            fb = None

        page = bbox_data.get("page", item.get("page", fb.page if fb else 1))
        x = bbox_data.get("x", fb.x if fb else 72)
        y = bbox_data.get("y", fb.y if fb else 100)
        w = bbox_data.get("width", fb.width if fb else 468)
        h = bbox_data.get("height", fb.height if fb else 40)

        findings.append(Finding(
            label=item.get("label", "Novelty concern"),
            reasoning=item.get("reasoning", ""),
            bbox=BoundingBox(
                page=max(page, 1),
                x=max(float(x), 0),
                y=max(float(y), 0),
                width=max(float(w), 10),
                height=max(float(h), 10),
            ),
            source_block_ids=[block_id] if block_id else [],
            pipeline_step=PipelineStep.compare,
        ))

    paper.findings.extend(findings)
    return paper
