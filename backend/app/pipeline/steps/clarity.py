"""Clarity dimension pass.

Looks for ambiguous prose, undefined symbols, and definitions used before
they're introduced. Returns Findings with `dimension="clarity"`.

Cost target: ~$0.15/paper (one Sonnet call against bulk of paper.markdown).
"""
from __future__ import annotations

import logging
from typing import Any, List, Optional

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


# Cap input. Paper markdowns can run 50K+ chars; we only need the prose
# (definitions/methods/discussion) to evaluate clarity. The proof bodies
# already get rigor-checked by verify_proofs, so trimming them out is fine.
_MAX_INPUT_CHARS = 18_000


_SYSTEM = """You are a senior reviewer evaluating the *clarity* of a technical paper. Find issues that would make it hard for a competent expert to follow the argument:

  - Symbols used before they are defined.
  - Notation reused with two different meanings.
  - Important assumptions tucked into prose that should be stated formally.
  - Pronoun references where the antecedent is ambiguous.
  - Definitions that are circular or rely on an undefined term.

Return a JSON array. Each element has EXACTLY:
  - issue_type:     "definition_mismatch" | "unstated_assumption" | "other"
  - severity:       "high" | "medium" | "low"
  - confidence:     0.0..1.0
  - description:    1-3 sentences pinpointing the clarity issue. Name the symbol/passage and what's wrong.
  - evidence_quote: the exact passage from the paper. Verbatim. Required for clarity findings — they're tied to specific text.

Calibration:
  - high   = a symbol or assumption load-bearing for the main result is unclear or undefined
  - medium = a definition could be misread; readers may need to re-read
  - low    = stylistic ambiguity or minor notation overload

Cap: at most 8 findings. Drop the weakest. Confidence floor 0.6. Output ONLY the JSON array."""


async def clarity_pass(
    paper: Paper,
    llm: LLMClient,
) -> List[Finding]:
    """One LLM call against the trimmed paper text. Returns clarity findings.
    Caller is responsible for appending them to paper.findings."""
    body = _trim_input(paper.markdown)
    if not body:
        return []

    prompt = (
        f"Title: {paper.title or paper.filename}\n\n"
        f"Paper text (truncated):\n\"\"\"\n{body}\n\"\"\""
    )

    cost_before = usage_tracker.cost_usd
    raw = await llm.complete_json(
        model=settings.text_model,
        messages=[{"role": "user", "content": prompt}],
        system=_SYSTEM,
        temperature=0.1,
        max_tokens=2048,
        tag="clarity",
    )
    cost = usage_tracker.cost_usd - cost_before

    if not isinstance(raw, list):
        logger.warning("clarity_pass: expected JSON array, got %s", type(raw).__name__)
        return []

    findings: List[Finding] = []
    for item in raw:
        f = _item_to_finding(item, paper)
        if f:
            findings.append(f)
    logger.info(
        "clarity_pass: paper %s → %d findings · raw_cost=$%.4f",
        paper.paper_id, len(findings), cost,
    )
    return findings


def _trim_input(markdown: str) -> str:
    """Truncate to a budget that holds clarity-relevant prose.

    Naive: take the first ~18KB. The intro/method/main-result sections are
    where most clarity issues hide; appendix proofs already get hammered by
    verify_proofs. Future improvement: skip blocks classified as 'proof'.
    """
    if not markdown:
        return ""
    if len(markdown) <= _MAX_INPUT_CHARS:
        return markdown
    return markdown[:_MAX_INPUT_CHARS] + "\n\n[... truncated for clarity pass]"


def _item_to_finding(item: Any, paper: Paper) -> Optional[Finding]:
    if not isinstance(item, dict):
        return None
    proof_block_id = (
        paper.proof_blocks[0].proof_block_id
        if paper.proof_blocks else f"_clarity_{paper.paper_id}"
    )

    severity_raw = (item.get("severity") or "medium").strip().lower()
    try:
        severity = Severity(severity_raw)
    except ValueError:
        severity = Severity.medium

    issue_raw = (item.get("issue_type") or "other").strip().lower()
    try:
        issue_type = IssueType(issue_raw)
    except ValueError:
        issue_type = IssueType.other

    try:
        confidence = float(item.get("confidence") or 0.6)
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = 0.6

    description = (item.get("description") or "").strip()
    evidence_quote = (item.get("evidence_quote") or "").strip()
    if not description or not evidence_quote:
        return None

    return Finding(
        proof_block_id=proof_block_id,
        issue_type=issue_type,
        severity=severity,
        confidence=confidence,
        description=description,
        evidence_quote=evidence_quote,
        page=1,  # localize pass refines
        bbox=None,
        localize_status=LocalizeStatus.pending,
        visually_verified=False,
        dimension=Dimension.clarity,
    )
