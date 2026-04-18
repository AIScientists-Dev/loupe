"""Step 3: EXAMINE — LLM analyzes each block in context, produces preliminary findings."""
from __future__ import annotations

from typing import List

from app.models import BoundingBox, Finding, Paper, PipelineStep, UserProfile
from app.pipeline.prompts.sections import build_examine_prompt
from app.services.llm_client import LLMClient


async def run_examine(paper: Paper, profile: UserProfile, llm: LLMClient) -> Paper:
    prompt = build_examine_prompt(
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
        # Find the source block to use its bbox if the LLM didn't provide good coords
        block_id = item.get("block_id", "")
        source_block = next((b for b in paper.parsed_blocks if b.block_id == block_id), None)
        if source_block:
            fallback_bbox = source_block.bbox
        else:
            fallback_bbox = None

        page = bbox_data.get("page", item.get("page", fallback_bbox.page if fallback_bbox else 1))
        x = bbox_data.get("x", fallback_bbox.x if fallback_bbox else 72)
        y = bbox_data.get("y", fallback_bbox.y if fallback_bbox else 200)
        w = bbox_data.get("width", fallback_bbox.width if fallback_bbox else 468)
        h = bbox_data.get("height", fallback_bbox.height if fallback_bbox else 40)

        findings.append(Finding(
            label=item.get("label", "Unnamed finding"),
            reasoning=item.get("reasoning", ""),
            bbox=BoundingBox(
                page=max(page, 1),
                x=max(float(x), 0),
                y=max(float(y), 0),
                width=max(float(w), 10),
                height=max(float(h), 10),
            ),
            source_block_ids=[block_id] if block_id else [],
            pipeline_step=PipelineStep.examine,
        ))

    paper.findings.extend(findings)
    return paper
