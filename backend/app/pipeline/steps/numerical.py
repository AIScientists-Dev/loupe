"""Numerical dimension pass.

Sanity-checks experimental claims: row/column sums in tables, std-dev signs,
monotonicity claims, percentage-improvement arithmetic. Deliberately narrow
per §7 of the v2 plan ("LLMs are bad at table arithmetic" — start narrow).
NOT p-values or significance tests — too noisy.

Returns Findings with `dimension="numerical"`.

Cost target: ~$0.10/paper (one Sonnet call against the experiment-flavored
slice of the markdown).
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


_MAX_INPUT_CHARS = 14_000


_SYSTEM = """You are a careful empirical reviewer doing a numerical sanity check on a paper's claims. Your job is NARROW. Only flag claims that are arithmetically inconsistent given the numbers in the paper itself — not "this seems implausible vs. the literature."

In scope:
  - Reported percentage improvements that don't match the underlying numbers (e.g. "27% improvement" but baseline=10, new=12 → 20%).
  - Table rows or columns whose stated total doesn't match the entries.
  - Monotonicity claims ("performance improves with X") contradicted by the paper's own table.
  - Standard deviations or variances reported with the wrong sign or out of plausible range.

Out of scope (do NOT flag):
  - p-values, significance, statistical power.
  - Whether a baseline is fair.
  - Hyperparameter choices.
  - Anything requiring external knowledge or re-running experiments.

Return a JSON array. Each element has EXACTLY:
  - issue_type:     "arithmetic" | "wrong_constant" | "other"
  - severity:       "high" | "medium" | "low"
  - confidence:     0.0..1.0 (≥0.75 required — false positives here erode trust fast)
  - description:    1-3 sentences explaining the inconsistency. Show the math: what was claimed, what the numbers actually give.
  - evidence_quote: the exact passage or table snippet. Verbatim.

Cap: at most 5 findings. Output ONLY the JSON array. Empty `[]` if nothing material — silence is fine here."""


async def numerical_pass(
    paper: Paper,
    llm: LLMClient,
) -> List[Finding]:
    """Run one LLM call against the experiments/results slice of the paper.
    Returns numerical findings."""
    body = _experiments_slice(paper.markdown)
    if not body:
        logger.info("numerical_pass: paper %s has no experiments-like content — skipping", paper.paper_id)
        return []

    prompt = (
        f"Title: {paper.title or paper.filename}\n\n"
        f"Experiments / results section:\n\"\"\"\n{body}\n\"\"\""
    )

    cost_before = usage_tracker.cost_usd
    raw = await llm.complete_json(
        model=settings.text_model,
        messages=[{"role": "user", "content": prompt}],
        system=_SYSTEM,
        temperature=0.0,
        max_tokens=1500,
        tag="numerical",
    )
    cost = usage_tracker.cost_usd - cost_before

    if not isinstance(raw, list):
        logger.warning("numerical_pass: expected JSON array, got %s", type(raw).__name__)
        return []

    findings: List[Finding] = []
    for item in raw:
        f = _item_to_finding(item, paper)
        if f:
            findings.append(f)
    logger.info(
        "numerical_pass: paper %s → %d findings · raw_cost=$%.4f",
        paper.paper_id, len(findings), cost,
    )
    return findings


def _experiments_slice(markdown: str) -> str:
    """Take the experiments/results portion. Heuristic: search for a heading
    matching 'experiment'/'result'/'numerical'/'evaluation' and take from
    there to a budget. Falls back to the back half of the paper."""
    if not markdown:
        return ""
    lower = markdown.lower()
    candidates = ("\n# experiment", "\n# results", "\n# numerical", "\n# evaluation",
                  "\n## experiment", "\n## results", "\n## numerical", "\n## evaluation")
    start = -1
    for marker in candidates:
        idx = lower.find(marker)
        if idx > 0 and (start < 0 or idx < start):
            start = idx
    if start < 0:
        # Fallback: assume experiments live in the back half.
        start = len(markdown) // 2
    slice_ = markdown[start:start + _MAX_INPUT_CHARS]
    if len(markdown) > start + _MAX_INPUT_CHARS:
        slice_ += "\n\n[... truncated for numerical pass]"
    return slice_


def _item_to_finding(item: Any, paper: Paper) -> Optional[Finding]:
    if not isinstance(item, dict):
        return None

    severity_raw = (item.get("severity") or "medium").strip().lower()
    try:
        severity = Severity(severity_raw)
    except ValueError:
        severity = Severity.medium

    issue_raw = (item.get("issue_type") or "arithmetic").strip().lower()
    try:
        issue_type = IssueType(issue_raw)
    except ValueError:
        issue_type = IssueType.arithmetic

    try:
        confidence = float(item.get("confidence") or 0.0)
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = 0.0

    # High-confidence floor: the prompt asks ≥0.75 but defensively re-check.
    if confidence < 0.75:
        return None

    description = (item.get("description") or "").strip()
    evidence_quote = (item.get("evidence_quote") or "").strip()
    if not description or not evidence_quote:
        return None

    proof_block_id = (
        paper.proof_blocks[0].proof_block_id
        if paper.proof_blocks else f"_numerical_{paper.paper_id}"
    )

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
        dimension=Dimension.numerical,
    )
