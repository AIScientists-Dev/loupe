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
from typing import Any, Dict, List, Optional

from app.config import settings
from app.models import PageMapEntry, Paper, ProofBlock, ProofKind
from app.services.llm_client import LLMClient

logger = logging.getLogger(__name__)


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


async def run_extract_proofs(paper: Paper, llm: LLMClient, bus=None) -> None:
    if not paper.markdown:
        logger.warning("extract_proofs: empty markdown for paper %s", paper.paper_id)
        paper.proof_blocks = []
        return

    prompt = f"Markdown:\n\n\"\"\"\n{paper.markdown}\n\"\"\""
    try:
        raw = await llm.complete_json(
            model=settings.text_model,
            messages=[{"role": "user", "content": prompt}],
            system=_SYSTEM,
            temperature=0.0,
            max_tokens=8192,
        )
    except Exception as exc:
        logger.exception("extract_proofs: LLM call failed for %s", paper.paper_id)
        raise

    if not isinstance(raw, list):
        raise ValueError(f"extract_proofs: expected JSON array, got {type(raw).__name__}")

    blocks: List[ProofBlock] = []
    for item in raw:
        block = _item_to_block(item, paper.markdown, paper.page_map)
        if block:
            blocks.append(block)

    paper.proof_blocks = blocks
    logger.info("extract_proofs: paper %s → %d proof blocks", paper.paper_id, len(blocks))


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
    char_start = _locate(markdown, anchor, label)
    if char_start < 0:
        logger.warning(
            "extract_proofs: could not locate block in markdown (label=%s kind=%s); skipping",
            label, kind.value,
        )
        return None

    body_end = char_start + len(anchor)
    if body and statement:
        body_start = _locate(markdown, body, None, after=body_end)
        if body_start >= 0:
            body_end = max(body_end, body_start + len(body))

    page_hint = _page_for_offset(page_map, char_start) or 1
    section = _section_for_offset(page_map, char_start)
    bbox = _bbox_for_offset(page_map, char_start)

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


def _locate(markdown: str, text: str, label: Optional[str], after: int = 0) -> int:
    """Find `text` in `markdown`. Try exact, then anchored by label + prefix."""
    if not text:
        return -1

    # 1. exact substring
    idx = markdown.find(text, after)
    if idx >= 0:
        return idx

    # 2. anchor on the first line (first 120 chars) — robust to trailing whitespace diffs
    anchor = text[:120].strip()
    if anchor:
        idx = markdown.find(anchor, after)
        if idx >= 0:
            return idx

    # 3. anchor on label + first 40 chars of statement
    if label:
        needle = label
        short = text[:40].strip()
        combo = f"{needle}" if not short else f"{needle} ({short[:30]}"
        idx = markdown.find(combo, after)
        if idx >= 0:
            return idx
        idx = markdown.find(needle, after)
        if idx >= 0:
            return idx

    return -1


def _page_for_offset(page_map: List[PageMapEntry], offset: int) -> Optional[int]:
    for entry in page_map:
        if entry.char_start <= offset < entry.char_end:
            return entry.page
    return page_map[-1].page if page_map else None


def _section_for_offset(page_map: List[PageMapEntry], offset: int) -> Optional[str]:
    for entry in page_map:
        if entry.char_start <= offset < entry.char_end:
            return entry.section
    return None


def _bbox_for_offset(page_map: List[PageMapEntry], offset: int):
    for entry in page_map:
        if entry.char_start <= offset < entry.char_end:
            return entry.bbox
    return None
