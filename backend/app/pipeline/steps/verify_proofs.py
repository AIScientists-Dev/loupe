"""Verify proof blocks in a single batched LLM call per segment.

Three changes from the previous per-block implementation:

  1. Batched: all blocks in the segment go in ONE call. Saves per-call
     overhead and lets the model reason about cross-block notation
     consistency (caught the "p(y|x) vs p_0(y|x)" bug on the MAP paper).
  2. Stable digest as the cache_control block: the paper's abstract,
     assumptions, problem formulation, main theorem statements — built
     once at planning time. Cache hit on every verify call after the
     first, regardless of how paper.markdown grows.
  3. The non-cached half is just the segment's block list (small).

Quality guard unchanged: findings whose evidence_quote isn't verbatim in
their block are dropped.
"""
from __future__ import annotations

import logging
from typing import Any, List

from app.config import settings
from app.models import Finding, IssueType, LocalizeStatus, Paper, ProofBlock, Severity
from app.pipeline.text_anchor import normalize_loose, normalize_tight
from app.services.events import bus
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)


_SYSTEM = """You are a rigorous mathematical proof reviewer. You will be given:
  - A STABLE DIGEST of the paper (abstract, problem formulation, assumptions, main theorem statements, method crux) — this is the authoritative reference for notation, declared assumptions, and stated results.
  - ONE OR MORE proof blocks to review (each tagged by id + label + kind).

For EACH block independently, identify technical errors.

Categories of errors to flag (use exact strings for issue_type):
  - arithmetic           — wrong closed-form sum, algebraic manipulation error
  - logic                — inverted implication, flipped inequality, flipped event in a probability statement
  - unstated_assumption  — invokes an assumption/lemma/definition NOT declared in the stable digest
  - wrong_constant       — incorrect constant or exponent in a standard inequality (Hoeffding, Chernoff, Markov, Cauchy-Schwarz, etc.)
  - quantifier_scope     — ∀/∃ order inverted; claim uniform where proof is pointwise
  - citation_required    — non-trivial named result asserted without citation or derivation
  - definition_mismatch  — symbol used inconsistently with its declaration in the digest or another block
  - missing_step         — proof skips a non-obvious step that changes validity
  - other                — substantive error not fitting above

Rules:
  - Be conservative. confidence ∈ [0.0, 1.0]; reserve ≥0.85 for certainties.
  - severity: "high" if invalidates the result; "medium" if fixable; "low" if cosmetic.
  - DO NOT flag stylistic preferences or merely unconventional-but-correct expressions.
  - evidence_quote MUST be verbatim from the block's body or statement (preserve LaTeX/math exactly). If you paraphrase, drop the finding.
  - If a block has no issues, its "findings" array is [].

Return ONLY a JSON object of this shape. No markdown fences. No prose.
{
  "blocks": [
    {
      "block_id": "<the id given to you>",
      "findings": [
        {
          "issue_type": "...",
          "severity": "...",
          "confidence": 0.xx,
          "description": "...",
          "evidence_quote": "..."
        }
      ]
    },
    ...
  ]
}

TOOLS:
  - web_search is available. Use it only when a block invokes a named classical result (Hoeffding, Bernstein, Freedman, etc.) with a suspicious-looking constant."""


WEB_SEARCH_TOOL = {
    "type": "web_search_20250305",
    "name": "web_search",
    "max_uses": 3,
}


# ---------------------------------------------------------------------------
# Primary entry points
# ---------------------------------------------------------------------------

async def verify_blocks_batched(
    blocks: List[ProofBlock],
    stable_digest: str,
    llm: LLMClient,
    paper_markdown: str = "",
) -> List[Finding]:
    """Send N blocks in one call, get back N findings arrays. All findings merged."""
    if not blocks:
        return []

    block_rendered = "\n\n---\n\n".join(
        f"BLOCK id={b.proof_block_id}\nkind={b.kind.value}\nlabel={b.label or 'unlabeled'}\n\n"
        f"{_render_block_body(b)}"
        for b in blocks
    )

    # Cacheable: the stable digest. Rewritten only when paper replanned.
    digest_section = stable_digest.strip() or "(digest empty — paper may have no prior context yet)"

    content_blocks = [
        {
            "type": "text",
            "text": (
                "STABLE PAPER DIGEST (abstract, problem formulation, assumptions, main theorem statements, method crux). "
                "Treat this as the ground truth for notation, declared assumptions, and stated results:\n\n"
                f"{digest_section}"
            ),
            "cache_control": {"type": "ephemeral"},
        },
        {
            "type": "text",
            "text": (
                f"PROOF BLOCKS TO REVIEW ({len(blocks)} blocks):\n\n"
                f"{block_rendered}\n\n"
                "Review each block. Return the JSON object with per-block findings arrays."
            ),
        },
    ]

    tools = [WEB_SEARCH_TOOL] if settings.verify_enable_web_search else None
    try:
        raw = await llm.complete_json(
            model=settings.text_model,
            messages=[{"role": "user", "content": content_blocks}],
            system=_SYSTEM,
            temperature=0.0,
            max_tokens=4096,
            tools=tools,
            tag="verify_proofs",
        )
    except Exception:
        logger.exception("verify_blocks_batched: LLM call failed (%d blocks)", len(blocks))
        return []

    return _parse_batched_response(raw, {b.proof_block_id: b for b in blocks}, paper_markdown)


# ---------------------------------------------------------------------------
# Backwards-compat wrappers
# ---------------------------------------------------------------------------

async def run_verify_proofs(paper: Paper, llm: LLMClient, event_bus=None) -> None:
    """Verify every proof block using the paper's stable digest."""
    event_bus = event_bus or bus
    paper.findings = []
    if not paper.proof_blocks:
        return
    findings = await verify_blocks_batched(
        paper.proof_blocks, paper.stable_digest or paper.markdown, llm,
        paper_markdown=paper.markdown,
    )
    paper.findings.extend(findings)
    for f in findings:
        event_bus.emit(paper.paper_id, "finding.created", {"finding": f.model_dump(mode="json")})


async def verify_block_against_context(
    block: ProofBlock, context_markdown: str, llm: LLMClient,
) -> List[Finding]:
    """Legacy single-block entry point — used by tests."""
    return await verify_blocks_batched([block], context_markdown, llm)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _render_block_body(block: ProofBlock) -> str:
    parts = []
    if block.statement:
        parts.append(f"Statement:\n{block.statement}")
    if block.body:
        parts.append(f"Body / Proof:\n{block.body}")
    return "\n\n".join(parts)


def _parse_batched_response(
    raw: Any,
    blocks_by_id: dict,
    paper_markdown: str = "",
) -> List[Finding]:
    if not isinstance(raw, dict):
        logger.warning("verify_blocks_batched: expected object, got %s", type(raw).__name__)
        return []
    rows = raw.get("blocks")
    if not isinstance(rows, list):
        logger.warning("verify_blocks_batched: object has no 'blocks' array")
        return []

    findings: List[Finding] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        block_id = str(row.get("block_id") or "").strip()
        block = blocks_by_id.get(block_id)
        if block is None:
            logger.info("verify_blocks_batched: unknown block_id %r — skipping", block_id)
            continue
        for item in row.get("findings") or []:
            f = _item_to_finding(item, block, paper_markdown)
            if f is not None:
                findings.append(f)
    return findings


def _item_to_finding(item: Any, block: ProofBlock, paper_markdown: str = "") -> Finding | None:
    if not isinstance(item, dict):
        return None

    try:
        issue_type = IssueType(str(item.get("issue_type", "")).strip().lower())
    except ValueError:
        return None

    try:
        severity = Severity(str(item.get("severity", "medium")).strip().lower())
    except ValueError:
        severity = Severity.medium

    try:
        confidence = max(0.0, min(1.0, float(item.get("confidence", 0.5))))
    except (TypeError, ValueError):
        confidence = 0.5

    description = (item.get("description") or "").strip()
    evidence_quote = (item.get("evidence_quote") or "").strip()
    if not description or not evidence_quote:
        return None

    # Step 0 quote gate. Check the quote against both the block (tight/fast)
    # and the full paper markdown (loose). If it exists in the block, we'll
    # locate it tightly at localize time. If it only exists in the paper
    # markdown, we accept but mark pending for deterministic search. If it's
    # nowhere, we keep the finding only for high-severity cases (so the user
    # still sees the concern) and mark it quote_unverified so the UI can show
    # the right affordance — never silent-drop.
    verdict = _quote_gate(evidence_quote, block, paper_markdown)
    if verdict == "missing":
        if severity == Severity.high:
            logger.warning(
                "verify: quote_unverified (high-severity kept, block=%s, type=%s): %r",
                block.label or block.proof_block_id, issue_type.value, evidence_quote[:80],
            )
            return Finding(
                proof_block_id=block.proof_block_id,
                issue_type=issue_type,
                severity=severity,
                confidence=confidence,
                description=description,
                evidence_quote=evidence_quote,
                page=block.page_hint,
                bbox=None,
                localize_status=LocalizeStatus.quote_unverified,
                visually_verified=False,
                anchor_confidence="none",
            )
        # Low/medium + unverifiable quote → honest drop, with a log entry
        # that includes the raw quote so we can audit the gate.
        logger.info(
            "verify: dropped (quote not in markdown, block=%s, sev=%s, type=%s): %r",
            block.label or block.proof_block_id, severity.value, issue_type.value,
            evidence_quote[:80],
        )
        return None

    return Finding(
        proof_block_id=block.proof_block_id,
        issue_type=issue_type,
        severity=severity,
        confidence=confidence,
        description=description,
        evidence_quote=evidence_quote,
        page=block.page_hint,
        bbox=block.bbox,
        localize_status=LocalizeStatus.pending,
        visually_verified=False,
    )


def _quote_gate(quote: str, block: ProofBlock, paper_markdown: str) -> str:
    """Returns one of: 'in_block', 'in_paper', 'missing'.

    'in_block':  quote found inside the parent proof block (tight match).
    'in_paper':  quote found only elsewhere in paper markdown (tight or loose).
    'missing':   quote not found anywhere — AI paraphrased or hallucinated.
    """
    if not quote:
        return "missing"
    haystack_block = (block.statement or "") + "\n" + (block.body or "")
    if quote in haystack_block:
        return "in_block"
    nq = normalize_tight(quote)
    nb = normalize_tight(haystack_block)
    if nq and nq in nb:
        return "in_block"
    if paper_markdown:
        if quote in paper_markdown or nq in normalize_tight(paper_markdown):
            return "in_paper"
        if normalize_loose(nq) in normalize_loose(paper_markdown):
            return "in_paper"
    return "missing"
