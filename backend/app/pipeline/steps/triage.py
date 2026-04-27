"""Step 0 — fast 60-second triage pass.

Runs immediately on upload, BEFORE the heavy MinerU+verify pipeline. Goal:
give the editor an H/M/L verdict on whether the paper is worth a deep dive,
plus a 4-block preview (scope / novelty / venue match / summary).

Strategy
--------
1. PyMuPDF text-extract the front matter (pages 1..N_FRONT) and back matter
   (last N_BACK pages, for references). No MinerU — we don't need formula-
   accurate parsing for triage.
2. Single Sonnet call with venue context. Returns a JSON object matching
   `TriageReport` fields exactly. Cost target ≤ $0.05.

The runner persists the result on `paper.triage` and flips `paper.stage`.
"""
from __future__ import annotations

import logging
from typing import Any, Dict

from app.config import settings
from app.models import Paper, TriageReport, TriageVerdict, VenueType
from app.services.llm_client import LLMClient, usage_tracker
from app.services.pricing import bill_user

logger = logging.getLogger(__name__)


# Front matter usually carries title + abstract + intro + (sometimes) related
# work. Back matter holds the references list. Together that's enough for a
# venue-fit + novelty assessment without the proofs/experiments.
_FRONT_PAGES = 6
_BACK_PAGES = 3

# Truncate raw extracted text to keep input tokens predictable. ~12K chars =
# ~3K tokens of input on Sonnet → ~$0.01. Combined with the ~600-token output
# we sit well under the $0.05/paper budget set in §5 of the v2 plan.
_MAX_INPUT_CHARS = 12_000


_SYSTEM = """You are a senior peer reviewer doing a 60-second triage of a paper for an editor.

The editor wants to know whether to invest in a full deep-dive review. You will be given the paper's front matter (title, abstract, intro) and back matter (references). The paper has been declared as targeting a specific venue type (journal / conference / grant proposal / thesis); calibrate your novelty + venue_match accordingly (a thesis review is not held to the same novelty bar as NeurIPS).

Return ONE JSON object with EXACTLY these fields:
  - scope:        1-2 sentences. What does the paper claim to do?
  - novelty:      2-3 sentences. How novel is the contribution relative to the references list and your prior knowledge of the area?
  - venue_match:  1-2 sentences. Does the contribution and rigor level fit the declared venue?
  - summary:      3-4 sentences. Editor-facing review summary preview (will be shown verbatim on the triage card).
  - verdict:      one of "high" | "medium" | "low"
                    high   = clearly worth a deep dive (novel, well-scoped, venue fit)
                    medium = mixed signal, deep dive is optional
                    low    = pass — minimal novelty, weak venue fit, or out of scope
  - confidence:   0.0..1.0 — your confidence in the verdict given how much you can see

Output ONLY the JSON object. No markdown fences, no commentary, no prose."""


async def triage_paper(
    paper: Paper,
    pdf_bytes: bytes,
    llm: LLMClient,
) -> TriageReport:
    """Run the triage pass. Returns a TriageReport ready to persist on the paper.

    Caller is responsible for setting `paper.triage = report` and flipping
    `paper.stage` from `triaging` → `triaged`.
    """
    cost_before = usage_tracker.cost_usd

    excerpt = _extract_excerpt(pdf_bytes)
    venue_label = _venue_label(paper.venue_type, paper.venue_name)

    prompt = (
        f"Declared venue: {venue_label}\n"
        f"Filename: {paper.filename}\n\n"
        f"Paper excerpt (front matter + references):\n\n"
        f"\"\"\"\n{excerpt}\n\"\"\""
    )

    raw = await llm.complete_json(
        model=settings.text_model,
        messages=[{"role": "user", "content": prompt}],
        system=_SYSTEM,
        temperature=0.2,
        max_tokens=1024,
        tag="triage",
    )

    cost = usage_tracker.cost_usd - cost_before
    report = _to_report(raw, cost_usd=bill_user(cost))
    logger.info(
        "triage: paper %s → verdict=%s confidence=%.2f cost_raw=$%.4f",
        paper.paper_id, report.verdict.value, report.confidence, cost,
    )
    return report


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_excerpt(pdf_bytes: bytes) -> str:
    """PyMuPDF extract front + back pages, concatenated and truncated.

    We pull from both ends: front gives us scope + novelty signals (abstract,
    intro), back gives us the references list which the LLM uses to calibrate
    "vs prior work" claims.
    """
    import fitz  # PyMuPDF

    pieces: list[str] = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        n = doc.page_count
        # Front pages (always include — title/abstract/intro live here).
        for i in range(min(_FRONT_PAGES, n)):
            text = doc.load_page(i).get_text("text").strip()
            if text:
                pieces.append(f"[front p.{i + 1}]\n{text}")
        # Back pages (skip if the paper is shorter than front+back, otherwise
        # we'd duplicate content).
        if n > _FRONT_PAGES + _BACK_PAGES:
            for i in range(max(_FRONT_PAGES, n - _BACK_PAGES), n):
                text = doc.load_page(i).get_text("text").strip()
                if text:
                    pieces.append(f"[back p.{i + 1}]\n{text}")

    excerpt = "\n\n".join(pieces).strip()
    if len(excerpt) > _MAX_INPUT_CHARS:
        # Keep front and back; drop the middle of the truncation. Front is
        # always more valuable so weight it 70/30.
        front_share = int(_MAX_INPUT_CHARS * 0.7)
        back_share = _MAX_INPUT_CHARS - front_share - 64
        excerpt = (
            excerpt[:front_share]
            + "\n\n[... middle truncated for triage ...]\n\n"
            + excerpt[-back_share:]
        )
    return excerpt


def _venue_label(venue_type: VenueType, venue_name: str | None) -> str:
    """Human-readable venue string for the prompt."""
    base = venue_type.value
    if venue_name:
        return f"{venue_name} ({base})"
    return base


def _to_report(raw: Any, *, cost_usd: float) -> TriageReport:
    """Coerce the LLM JSON into a validated TriageReport.

    Guards against missing/garbled fields by falling back to safe defaults
    rather than raising — a triage that produced empty strings is still
    surfaceable in the UI as "model failed to triage" rather than blocking
    the upload entirely.
    """
    if not isinstance(raw, dict):
        raw = {}

    verdict_raw = (raw.get("verdict") or "medium").strip().lower()
    try:
        verdict = TriageVerdict(verdict_raw)
    except ValueError:
        logger.warning("triage: unknown verdict %r — defaulting to medium", verdict_raw)
        verdict = TriageVerdict.medium

    try:
        confidence = float(raw.get("confidence") or 0.5)
        confidence = max(0.0, min(1.0, confidence))
    except (TypeError, ValueError):
        confidence = 0.5

    return TriageReport(
        scope=str(raw.get("scope") or "").strip() or "(model returned empty scope)",
        novelty=str(raw.get("novelty") or "").strip() or "(model returned empty novelty)",
        venue_match=str(raw.get("venue_match") or "").strip() or "(model returned empty venue match)",
        summary=str(raw.get("summary") or "").strip() or "(model returned empty summary)",
        verdict=verdict,
        confidence=confidence,
        cost_usd=round(cost_usd, 6),
    )
