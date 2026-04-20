"""Step 2 — extract theorem/lemma/proposition/proof blocks from paper markdown.

Strategy
--------
1. Ask the LLM to return a JSON list of {kind, label, statement, body}.
   No char offsets — LLMs hallucinate them.
2. Server-side, locate each statement's verbatim text in the markdown to
   compute char_start/char_end.
3. Page_hint comes from looking up char_start in the paper's page_map.
4. Drop any block we can't locate in the markdown (logged, not fatal).
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from app.config import settings
from app.models import PageMapEntry, Paper, ProofBlock, ProofKind
from app.pipeline.text_anchor import (
    bbox_for_offset,
    locate_legacy,
    page_for_offset,
    section_for_offset,
)
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)

# Cheap regex pre-filter: if the segment's markdown has zero tokens that
# look like formal-proof markers, skip the LLM extract call entirely.
# Saves 2–3 empty calls per typical paper (~$0.06).
_PROOF_MARKER_RE = re.compile(
    r"\b(?:theorem|lemma|proposition|corollary|claim|proof)\b",
    re.IGNORECASE,
)


_SYSTEM = """You are a mathematical proof structure extractor. Given a paper's markdown, identify every formal theorem-like statement (theorem, lemma, proposition, corollary, claim) and its proof (if present in the same paper).

Return a JSON array. Each element MUST have exactly these fields:
  - kind:      one of "theorem" | "lemma" | "proposition" | "corollary" | "claim" | "proof"
  - label:     the numbered label in the paper, e.g. "Lemma 1", "Theorem 3.2", "Corollary 1.1". Empty string if unlabeled.
  - statement: the full statement text, verbatim from the markdown, INCLUDING all math. Preserve LaTeX exactly.
  - body:      the proof/derivation text accompanying this statement, verbatim from the markdown. Empty string "" if no proof appears in the paper.

Rules:
- Pair each statement with its proof: kind stays "theorem"/"lemma"/etc., body holds the proof text.
- If a stand-alone "Proof of ..." block appears without its statement nearby (e.g. in an appendix referencing a theorem from an earlier section), emit a separate entry with kind="proof", label referring to the target theorem, statement empty, body holding the proof.
- Skip informal remarks, examples, definitions, assumptions, discussions.
- Output ONLY the JSON array. No markdown fences, no commentary, no prose before or after."""


async def extract_proofs_from_markdown(
    markdown: str,
    page_map: List[PageMapEntry],
    llm: LLMClient,
) -> List[ProofBlock]:
    """Run the extractor against a single chunk of markdown + its page_map.

    Used by the segmented pipeline: pass only the segment's markdown and
    the slice of page_map covering that segment. char offsets in the
    returned ProofBlocks are relative to `markdown`. The caller is
    responsible for shifting them into the paper's aggregate markdown if
    it wants to merge (offset += aggregate_length at merge time).
    """
    if not markdown:
        return []

    # Keyword pre-filter: avoid the LLM call if nothing proof-like is present.
    if not _PROOF_MARKER_RE.search(markdown):
        logger.info("extract_proofs: no proof markers in segment markdown — skipping LLM call")
        return []

    prompt = f"Markdown:\n\n\"\"\"\n{markdown}\n\"\"\""
    raw = await llm.complete_json(
        model=settings.text_model,
        messages=[{"role": "user", "content": prompt}],
        system=_SYSTEM,
        temperature=0.0,
        max_tokens=8192,
        tag="extract_proofs",
    )

    if not isinstance(raw, list):
        raise ValueError(f"extract_proofs: expected JSON array, got {type(raw).__name__}")

    blocks: List[ProofBlock] = []
    for item in raw:
        block = _item_to_block(item, markdown, page_map)
        if block:
            blocks.append(block)
    return blocks


# Backwards-compat wrapper for the old monolithic pipeline (still used by
# anything that calls it against the whole paper).
async def run_extract_proofs(paper: Paper, llm: LLMClient, bus=None) -> None:
    paper.proof_blocks = await extract_proofs_from_markdown(
        paper.markdown, paper.page_map, llm,
    )
    logger.info("extract_proofs: paper %s → %d proof blocks", paper.paper_id, len(paper.proof_blocks))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _item_to_block(
    item: Any,
    markdown: str,
    page_map: List[PageMapEntry],
) -> Optional[ProofBlock]:
    if not isinstance(item, dict):
        return None

    kind_raw = (item.get("kind") or "").strip().lower()
    try:
        kind = ProofKind(kind_raw)
    except ValueError:
        logger.warning("extract_proofs: skipping unknown kind %r", kind_raw)
        return None

    label = (item.get("label") or "").strip() or None
    statement = (item.get("statement") or "").strip()
    body = (item.get("body") or "").strip()

    if not statement and not body:
        return None

    anchor = statement or body
    char_start = locate_legacy(markdown, anchor, label)
    if char_start < 0:
        logger.warning(
            "extract_proofs: could not locate block in markdown (label=%s kind=%s); skipping",
            label, kind.value,
        )
        return None

    body_end = char_start + len(anchor)
    if body and statement:
        body_start = locate_legacy(markdown, body, None, after=body_end)
        if body_start >= 0:
            body_end = max(body_end, body_start + len(body))

    page_hint = page_for_offset(page_map, char_start) or 1
    section = section_for_offset(page_map, char_start)
    bbox = bbox_for_offset(page_map, char_start)

    return ProofBlock(
        kind=kind,
        label=label,
        statement=statement,
        body=body,
        page_hint=page_hint,
        section=section,
        char_start=char_start,
        char_end=body_end,
        bbox=bbox,
    )


