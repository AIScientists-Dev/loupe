"""Literature dimension pass.

Reads the paper's references list and intro/abstract, asks the LLM to spot
missing citations, overclaimed novelty, and weak prior-art comparisons.
Findings get `dimension="literature"`.

Cost target: ~$0.10/paper (single Sonnet call, ~3K input tokens, 800 output).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from app.config import settings
from app.models import (
    Dimension,
    Finding,
    IssueType,
    LocalizeStatus,
    Paper,
    Severity,
)
from app.services.llm_client import LLMClient, usage_tracker

logger = logging.getLogger(__name__)


_SYSTEM = """You are a critical referee evaluating a paper's engagement with prior work. Identify gaps in citation coverage and overclaimed novelty. Be specific and grounded — vague complaints help no one.

Return a JSON array. Each element is one finding with EXACTLY these fields:
  - issue_type:     "citation_required" | "other"
  - severity:       "high" | "medium" | "low"
  - confidence:     0.0..1.0 (your confidence in the finding)
  - description:    1-3 sentences explaining the gap. Name the specific prior work that should be cited or the specific novelty claim that is overstated.
  - evidence_quote: the exact passage from the paper (intro / related work) that's affected. Verbatim. Empty string allowed only if the issue is "missing reference list entry" not tied to a specific passage.

Calibration:
  - high   = a major prior result is missing AND the paper makes a directly contradicting novelty claim
  - medium = standard related work missing OR novelty is overstated relative to the cited references
  - low    = minor reference suggestion (newer survey, alternative method)

Only flag issues you are at least 0.6 confident about. Output ONLY the JSON array. Empty array `[]` if nothing material.

Reasonable cap: at most 6 findings — drop the weakest if you have more."""


async def literature_pass(
    paper: Paper,
    llm: LLMClient,
) -> List[Finding]:
    """Run one LLM call against the paper's intro + bibliography. Returns
    Findings tagged with dimension=literature. The caller is responsible for
    appending them to paper.findings."""
    refs_section = _extract_references_section(paper.markdown)
    intro_section = _extract_intro_section(paper.markdown)
    if not refs_section and not intro_section:
        logger.info("literature_pass: paper %s has no extractable refs/intro — skipping", paper.paper_id)
        return []

    prompt = (
        f"Declared venue: {paper.venue_name or paper.venue_type.value}\n"
        f"Title: {paper.title or paper.filename}\n\n"
        "Intro / related-work excerpt:\n"
        f"\"\"\"\n{intro_section[:4000]}\n\"\"\"\n\n"
        "References list:\n"
        f"\"\"\"\n{refs_section[:6000]}\n\"\"\""
    )

    cost_before = usage_tracker.cost_usd
    raw = await llm.complete_json(
        model=settings.text_model,
        messages=[{"role": "user", "content": prompt}],
        system=_SYSTEM,
        temperature=0.1,
        max_tokens=2048,
        tag="literature",
    )
    cost = usage_tracker.cost_usd - cost_before

    if not isinstance(raw, list):
        logger.warning("literature_pass: expected JSON array, got %s", type(raw).__name__)
        return []

    findings: List[Finding] = []
    for item in raw:
        f = _item_to_finding(item, paper)
        if f:
            findings.append(f)

    logger.info(
        "literature_pass: paper %s → %d findings · raw_cost=$%.4f",
        paper.paper_id, len(findings), cost,
    )
    return findings


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_intro_section(markdown: str) -> str:
    """Pull the intro / related work section from paper markdown.

    Heuristic: take everything from "abstract" or first "introduction"
    heading until we hit the first "method"/"approach"/"theorem"-style
    heading. Bounded so we never balloon the prompt past a few KB.
    """
    if not markdown:
        return ""
    lower = markdown.lower()
    start = lower.find("abstract")
    if start < 0:
        start = lower.find("introduction")
    if start < 0:
        start = 0
    # Stop at the first section heading that looks "post-intro".
    stop_markers = ("\n# method", "\n# approach", "\n# main result", "\n## method",
                    "\n## approach", "\n## main result", "\n# theorem", "\n## theorem",
                    "\n# preliminaries", "\n## preliminaries")
    end = len(markdown)
    for marker in stop_markers:
        idx = lower.find(marker, start)
        if idx > 0 and idx < end:
            end = idx
    section = markdown[start:end]
    return section[:8000]


def _extract_references_section(markdown: str) -> str:
    """Pull the references / bibliography section from paper markdown."""
    if not markdown:
        return ""
    lower = markdown.lower()
    for header in ("\nreferences\n", "\nreferences ", "\nbibliography\n", "\n# references", "\n## references"):
        idx = lower.find(header)
        if idx > 0:
            return markdown[idx:]
    # Fall back: take the last 8KB of the paper.
    return markdown[-8000:]


def _item_to_finding(item: Any, paper: Paper) -> Optional[Finding]:
    if not isinstance(item, dict):
        return None
    # A literature finding doesn't always tie to a proof block — pick the
    # first proof block as a soft anchor (frontend mostly uses this for
    # decide/investigate threading), or synthesize a placeholder id.
    proof_block_id = (
        paper.proof_blocks[0].proof_block_id
        if paper.proof_blocks else f"_literature_{paper.paper_id}"
    )

    severity_raw = (item.get("severity") or "medium").strip().lower()
    try:
        severity = Severity(severity_raw)
    except ValueError:
        severity = Severity.medium

    issue_raw = (item.get("issue_type") or "citation_required").strip().lower()
    try:
        issue_type = IssueType(issue_raw)
    except ValueError:
        issue_type = IssueType.citation_required

    try:
        confidence = float(item.get("confidence") or 0.6)
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = 0.6

    description = (item.get("description") or "").strip()
    if not description:
        return None
    evidence_quote = (item.get("evidence_quote") or "").strip()

    # Page guess: 1 — literature critiques target the related-work section
    # which usually lives on page 1 or 2. The localize pass can refine.
    return Finding(
        proof_block_id=proof_block_id,
        issue_type=issue_type,
        severity=severity,
        confidence=confidence,
        description=description,
        evidence_quote=evidence_quote,
        page=1,
        bbox=None,
        localize_status=LocalizeStatus.pending,
        visually_verified=False,
        dimension=Dimension.literature,
    )
