"""Step-specific prompt builder functions."""
from __future__ import annotations

from typing import List, Optional

from app.models import Exchange, Finding, LearnedRule, ParsedBlock
from app.pipeline.prompts.builder import PromptBuilder


def build_survey_prompt(
    blocks: List[ParsedBlock],
    focus_areas: List[str],
    learned_rules: List[LearnedRule],
) -> str:
    return (
        PromptBuilder()
        .add_role(
            "You are an expert academic reviewer conducting an initial survey of a "
            "research paper. Read the full paper and produce a structured understanding "
            "of its claims, proof structure, methodology, and contributions."
        )
        .add_paper_content(blocks)
        .add_focus_areas(focus_areas)
        .add_learned_rules(learned_rules)
        .add_output_schema(
            "Produce a JSON object with these fields:",
            '{\n'
            '  "title": "...",\n'
            '  "main_claims": ["claim 1", "claim 2"],\n'
            '  "proof_structure": "Description of how proofs are organized",\n'
            '  "methodology": "Description of methodology",\n'
            '  "key_assumptions": ["assumption 1", "assumption 2"],\n'
            '  "cited_works_summary": "Brief summary of related work cited",\n'
            '  "potential_concern_areas": ["area 1", "area 2"]\n'
            '}',
        )
        .build()
    )


def build_examine_prompt(
    blocks: List[ParsedBlock],
    survey_summary: str,
    focus_areas: List[str],
    learned_rules: List[LearnedRule],
) -> str:
    return (
        PromptBuilder()
        .add_role(
            "You are a meticulous reviewer examining each proof step and claim in "
            "detail. For each block, analyze logical validity, check for hidden "
            "assumptions, verify equation transitions, and identify potential gaps. "
            "Only flag something if you are confident it is genuinely suspicious — "
            "do not flag standard or well-known techniques."
        )
        .add_survey_context(survey_summary)
        .add_paper_content(blocks)
        .add_focus_areas(focus_areas)
        .add_learned_rules(learned_rules)
        .add_output_schema(
            "Return a JSON array. Each element is a suspicious finding. "
            "Only include findings you are confident about (binary YES). "
            "Provide detailed reasoning (2-5 sentences).",
            '[\n'
            '  {\n'
            '    "label": "Short label (e.g. Gap in induction proof)",\n'
            '    "reasoning": "2-5 sentences explaining exactly what is wrong",\n'
            '    "block_id": "the block_id this relates to",\n'
            '    "page": 3,\n'
            '    "bbox": {"page": 3, "x": 72, "y": 260, "width": 468, "height": 80}\n'
            '  }\n'
            ']',
        )
        .build()
    )


def build_compare_prompt(
    blocks: List[ParsedBlock],
    survey_summary: str,
    focus_areas: List[str],
    learned_rules: List[LearnedRule],
) -> str:
    return (
        PromptBuilder()
        .add_role(
            "You are a novelty assessor comparing this paper's claims against the "
            "related work it cites. Identify claims of novelty that are overstated, "
            "contributions that appear to already exist in cited references, or "
            "important related work that is missing. Only flag genuine concerns."
        )
        .add_survey_context(survey_summary)
        .add_paper_content(blocks)
        .add_focus_areas(focus_areas)
        .add_learned_rules(learned_rules)
        .add_output_schema(
            "Return a JSON array of novelty concerns.",
            '[\n'
            '  {\n'
            '    "label": "Novelty claim overstated vs [Author 2018]",\n'
            '    "reasoning": "2-5 sentences explaining the overlap or gap",\n'
            '    "block_id": "the block_id of the claim",\n'
            '    "page": 5,\n'
            '    "bbox": {"page": 5, "x": 72, "y": 100, "width": 468, "height": 40}\n'
            '  }\n'
            ']',
        )
        .build()
    )


def build_verdict_prompt(
    findings: List[Finding],
    blocks: List[ParsedBlock],
    survey_summary: str,
    focus_areas: List[str],
    learned_rules: List[LearnedRule],
) -> str:
    return (
        PromptBuilder()
        .add_role(
            "You are a senior reviewer making final binary decisions on preliminary "
            "findings. For each finding below, decide: is this genuinely suspicious "
            "(YES) or a false alarm (NO)? Only keep findings you are confident about. "
            "For each YES finding, refine the reasoning to be precise and actionable."
        )
        .add_survey_context(survey_summary)
        .add_paper_content(blocks, include_full=False)
        .add_findings(findings)
        .add_focus_areas(focus_areas)
        .add_learned_rules(learned_rules)
        .add_output_schema(
            "Return a JSON array of ONLY the findings that pass (YES). "
            "Use the same finding_id. Refine the reasoning.",
            '[\n'
            '  {\n'
            '    "finding_id": "original-id",\n'
            '    "label": "Refined label",\n'
            '    "reasoning": "Refined 2-5 sentence reasoning"\n'
            '  }\n'
            ']',
        )
        .build()
    )


def build_investigate_prompt(
    finding: Finding,
    direction: str,
    blocks: List[ParsedBlock],
    survey_summary: str,
    prior_exchanges: List[Exchange],
) -> str:
    b = (
        PromptBuilder()
        .add_role(
            "You are a reviewer following up on a specific finding based on the "
            "user's direction. Think carefully about what the user is asking you "
            "to check, then provide a thorough analysis."
        )
        .add_survey_context(survey_summary)
        .add_paper_content(blocks)
        .add("Original Finding", f"**{finding.label}**\n{finding.reasoning}")
    )

    if prior_exchanges:
        history = []
        for ex in prior_exchanges:
            history.append(f"User: {ex.user_direction}\nAI: {ex.ai_response}")
        b.add("Prior Investigation", "\n\n---\n\n".join(history))

    b.add("User Direction", direction)
    b.add(
        "Instructions",
        "Provide a thorough analysis following the user's direction. "
        "Be specific, reference exact equations/theorems/sections. "
        "Respond in plain text (not JSON).",
    )
    return b.build()


def build_review_prompt(
    survey_summary: str,
    classified_findings: dict,
    template_sections: dict,
    style_prompt: str,
    tone_prompt: str,
) -> str:
    b = (
        PromptBuilder()
        .add_role(
            "You are generating a structured academic review of a paper. "
            "Ground your review in the analysis findings provided."
        )
        .add_survey_context(survey_summary)
    )

    # Add finding classifications
    if classified_findings.get("agreed"):
        items = "\n".join(
            f"- {f['label']}: {f['reasoning']}" for f in classified_findings["agreed"]
        )
        b.add("Confirmed Issues (use as weaknesses)", items)

    if classified_findings.get("investigating"):
        items = "\n".join(
            f"- {f['label']}: {f['reasoning']} [under investigation]"
            for f in classified_findings["investigating"]
        )
        b.add("Issues Under Investigation (mention with nuance)", items)

    if classified_findings.get("open"):
        items = "\n".join(
            f"- {f['label']}: {f['reasoning']} [tentative]"
            for f in classified_findings["open"]
        )
        b.add("Tentative Issues (flag as potential concerns)", items)

    # Template structure
    section_guide = "\n".join(
        f"### {name}\n{instruction}" for name, instruction in template_sections.items()
    )
    b.add("Review Structure", f"Write the review with these sections:\n\n{section_guide}")
    b.add("Style", style_prompt)
    b.add("Tone", tone_prompt)
    b.add(
        "Output Format",
        "Return the review as markdown text. Use ## headings for each section.",
    )
    return b.build()
