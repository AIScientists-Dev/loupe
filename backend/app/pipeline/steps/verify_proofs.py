"""Step 3 — verify each proof block; emit Findings for detected issues.

For each proof_block, call the LLM with (block, full paper context) and ask it
to identify technical errors. Parse the response into Finding objects.

We drop any finding whose evidence_quote is not an actual substring of the
block's statement+body — that filters hallucinated quotes.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from app.config import settings
from app.models import (
    BoundingBox,
    Finding,
    IssueType,
    LocalizeStatus,
    Paper,
    ProofBlock,
    Severity,
)
from app.services.events import bus
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)


_SYSTEM = """You are a rigorous mathematical proof reviewer. For the given proof block, identify any technical errors. The block comes from a formal paper (statistics / ML theory) — the author intends rigorous claims.

Categories of errors to flag (use exact strings for issue_type):
  - arithmetic           — e.g. wrong closed-form sum, algebraic manipulation error
  - logic                — inverted implication, conflating ≤ with ≥, flipped event in a probability statement
  - unstated_assumption  — the proof invokes an assumption/lemma/definition that is NOT declared in the paper (check the provided paper context)
  - wrong_constant       — incorrect constant or exponent in a standard inequality (Hoeffding, Chernoff, Markov, Cauchy-Schwarz, etc.)
  - quantifier_scope     — ∀/∃ order inverted; claim uniform where proof is pointwise; N depends on δ but statement is "for all n"
  - citation_required    — a numerical constant, a named theorem, or a non-trivial claim is stated as fact but requires a citation or known external result to be verified
  - definition_mismatch  — a term/symbol is used inconsistently with its declared definition
  - missing_step         — the proof skips a non-obvious step that changes the validity
  - other                — substantive error not fitting above

Rules:
  - Be conservative. Only flag things you are confident are errors. confidence ∈ [0.0, 1.0] — reserve ≥0.85 for certainties, 0.5–0.7 for well-reasoned suspicion.
  - severity: "high" if the error invalidates the stated result; "medium" if the result may still hold but the proof as written is broken; "low" for cosmetic or easily-fixed issues.
  - DO NOT flag stylistic preferences, conventions, or merely unconventional but correct expressions.
  - evidence_quote MUST be a verbatim substring of the proof block (statement or body). Preserve LaTeX/math delimiters exactly. If the quote isn't verbatim in the block, omit the finding.
  - description: 1–3 sentences. Be precise about WHAT is wrong and WHY.
  - If the proof block has no errors, return an empty array [].

TOOLS:
  - You may use web_search to verify named classical results (e.g. Hoeffding inequality constants, Chernoff bounds, Nemirovski-type rates) when the proof invokes them by name. Use it only when it genuinely helps adjudicate an issue, not for every block.

Return ONLY a JSON array as your final answer. No markdown fences. No prose. No explanations outside the array."""


WEB_SEARCH_TOOL = {
    "type": "web_search_20250305",
    "name": "web_search",
    "max_uses": 3,
}


async def run_verify_proofs(paper: Paper, llm: LLMClient, event_bus=None) -> None:
    event_bus = event_bus or bus
    paper.findings = []

    if not paper.proof_blocks:
        logger.info("verify_proofs: no proof blocks for paper %s — skipping", paper.paper_id)
        return

    for block in paper.proof_blocks:
        block_findings = await _verify_block(paper, block, llm)
        for f in block_findings:
            paper.findings.append(f)
            event_bus.emit(paper.paper_id, "finding.created", {"finding": f.model_dump(mode="json")})

    logger.info("verify_proofs: paper %s → %d findings", paper.paper_id, len(paper.findings))


async def _verify_block(paper: Paper, block: ProofBlock, llm: LLMClient) -> List[Finding]:
    block_text = _render_block(block)
    context = _render_context(paper, block)

    # Structured user message with cache_control on the paper context.
    # The first call for this paper writes the cache; subsequent calls for
    # other proof blocks hit it and pay ~10% of the input-token rate on the
    # shared markdown chunk.
    content_blocks = [
        {
            "type": "text",
            "text": (
                "PAPER CONTEXT (assumptions, definitions, other declarations from the full paper):\n\n"
                f"{context}"
            ),
            "cache_control": {"type": "ephemeral"},
        },
        {
            "type": "text",
            "text": (
                f"\n\nPROOF BLOCK UNDER REVIEW ({block.kind.value}, {block.label or 'unlabeled'}):\n\n"
                f"{block_text}\n\nReview this proof block for technical errors. Return the JSON array."
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
            max_tokens=2048,
            tools=tools,
            tag="verify_proofs",
        )
    except Exception:
        logger.exception("verify_proofs: LLM call failed on block %s", block.proof_block_id)
        return []

    if not isinstance(raw, list):
        logger.warning("verify_proofs: expected array, got %s for block %s", type(raw).__name__, block.proof_block_id)
        return []

    findings: List[Finding] = []
    for item in raw:
        f = _item_to_finding(item, block)
        if f is not None:
            findings.append(f)
    return findings


def _render_block(block: ProofBlock) -> str:
    parts = []
    if block.label:
        parts.append(f"[{block.label}]")
    if block.statement:
        parts.append(f"Statement:\n{block.statement}")
    if block.body:
        parts.append(f"Body / Proof:\n{block.body}")
    return "\n\n".join(parts)


def _render_context(paper: Paper, current: ProofBlock) -> str:
    """Full paper markdown — gives the verifier access to assumptions + cross-refs."""
    # Keep it simple: the whole markdown. Our fixture is 11K chars; real papers
    # fit comfortably within Sonnet's context for stat-theory-length papers.
    return paper.markdown


def _item_to_finding(item: Any, block: ProofBlock) -> Finding | None:
    if not isinstance(item, dict):
        return None

    try:
        issue_type = IssueType(str(item.get("issue_type", "")).strip().lower())
    except ValueError:
        logger.warning("verify_proofs: unknown issue_type %r", item.get("issue_type"))
        return None

    try:
        severity = Severity(str(item.get("severity", "medium")).strip().lower())
    except ValueError:
        severity = Severity.medium

    confidence_raw = item.get("confidence", 0.5)
    try:
        confidence = max(0.0, min(1.0, float(confidence_raw)))
    except (TypeError, ValueError):
        confidence = 0.5

    description = (item.get("description") or "").strip()
    evidence_quote = (item.get("evidence_quote") or "").strip()

    if not description or not evidence_quote:
        return None

    if not _quote_is_verbatim(evidence_quote, block):
        logger.info(
            "verify_proofs: dropped finding with non-verbatim quote (block=%s, type=%s): %r",
            block.label or block.proof_block_id, issue_type.value, evidence_quote[:60],
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


def _quote_is_verbatim(quote: str, block: ProofBlock) -> bool:
    """Accept the quote if it's a substring of statement OR body OR normalized text."""
    if not quote:
        return False
    haystack = (block.statement or "") + "\n" + (block.body or "")
    if quote in haystack:
        return True
    # Tolerate whitespace/newline differences.
    norm_q = _norm_ws(quote)
    norm_h = _norm_ws(haystack)
    return norm_q in norm_h


def _norm_ws(s: str) -> str:
    return " ".join(s.split())
