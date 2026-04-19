"""Build a stable-context digest for cheap prompt caching.

Called once per paper, right after planning. The digest holds the parts of
the paper the verifier keeps referring back to — abstract, assumptions,
problem formulation, main solution crux, theorem statements — extracted
via PyMuPDF (free, local, ~1s for 30 pages).

Unlike paper.markdown, the digest does NOT grow while segments process,
so Anthropic prompt-caching on the verify prompt lands cache hits on
every call after the first.
"""
from __future__ import annotations

import logging
from typing import List

from app.models import Paper, Segment, SegmentClassification

logger = logging.getLogger(__name__)

# Segments whose text goes into the digest. These are the parts proofs
# most commonly reference.
_DIGEST_CLASSIFICATIONS = {
    SegmentClassification.background,   # intro, problem formulation, assumptions, prelim, related work
    SegmentClassification.theorem,      # main result statements + method crux
}

# Keep digest small to maximize cache hit rate. Truncate to this many
# chars; anything beyond is almost never needed in a verify call.
_MAX_DIGEST_CHARS = 30_000


def build_digest(paper: Paper, pdf_bytes: bytes) -> str:
    """Return a concatenated text digest of the digest-classified segments."""
    import fitz  # PyMuPDF

    pages_to_include: List[int] = []
    section_labels: dict[int, str] = {}
    for seg in paper.segments:
        if seg.classification in _DIGEST_CLASSIFICATIONS and seg.priority > 0:
            for p in range(seg.page_start, seg.page_end + 1):
                pages_to_include.append(p)
                section_labels.setdefault(p, seg.label)

    if not pages_to_include:
        return ""

    pieces: List[str] = []
    with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
        for page_num in pages_to_include:
            idx = page_num - 1
            if idx < 0 or idx >= doc.page_count:
                continue
            text = doc.load_page(idx).get_text("text").strip()
            if not text:
                continue
            label = section_labels.get(page_num, f"page {page_num}")
            pieces.append(f"[p.{page_num} — {label}]\n{text}")

    digest = "\n\n".join(pieces).strip()
    if len(digest) > _MAX_DIGEST_CHARS:
        digest = digest[:_MAX_DIGEST_CHARS] + "\n\n[... digest truncated]"

    logger.info(
        "build_digest: paper %s → digest %d chars from %d pages",
        paper.paper_id, len(digest), len(pages_to_include),
    )
    return digest
