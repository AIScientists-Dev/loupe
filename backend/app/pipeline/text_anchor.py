"""Shared text-anchor utilities for locating quotes in paper.markdown and
looking up their bbox in page_map.

Used by:
  - extract_proofs: locate proof block statement/body char ranges.
  - localize:      locate a finding's evidence_quote and resolve its bbox
                   from MinerU's page_map — deterministic, no vision calls.

Design notes
------------
- One normalization pass by default (whitespace collapse, ignore leading `$`
  math delimiters). A second "loose" pass strips a small set of LaTeX macros
  that MinerU sometimes inlines differently than the verifying LLM emits.
- Substring search is O(n*m); acceptable because `paper.markdown` is
  typically <200 KB and findings are counted in tens per paper.
- No fuzzy matching beyond the two explicit normalization tiers — we'd
  rather surface `not_located` than paint a confident wrong box.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import List, Literal, Optional

from app.models import BoundingBox, PageMapEntry

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

_WHITESPACE_RE = re.compile(r"\s+")

# Macros MinerU may omit or rewrite. Kept narrow: only the common wrappers
# that change no semantics (visual macros for math styling).
_LOOSE_STRIP_RE = re.compile(
    r"\\(?:mathbf|mathrm|mathit|mathsf|mathtt|boldsymbol|bm|operatorname)\s*\{([^{}]*)\}"
)


def normalize_tight(s: str) -> str:
    """Collapse whitespace. Preserve LaTeX."""
    return _WHITESPACE_RE.sub(" ", s).strip()


def normalize_loose(s: str) -> str:
    """Tight + strip visual-only LaTeX wrappers. Use as a second-chance match."""
    stripped = _LOOSE_STRIP_RE.sub(r"\1", s)
    return normalize_tight(stripped)


# ---------------------------------------------------------------------------
# Occurrence search
# ---------------------------------------------------------------------------

AnchorConfidence = Literal["exact_in_block", "exact_near_block", "fuzzy_in_block", "fuzzy_far", "none"]


@dataclass(frozen=True)
class Occurrence:
    """One match location in the paper's aggregate markdown."""
    offset: int
    length: int
    normalization: Literal["tight", "loose"]


def all_occurrences(markdown: str, quote: str) -> List[Occurrence]:
    """Return every occurrence of `quote` in `markdown`, trying tight match
    first, then loose. If any tight match exists, loose matches are NOT
    returned (preserves the precision preference).
    """
    if not quote or not markdown:
        return []

    # Tight: search the normalized forms. We operate on the raw markdown so
    # offsets are directly usable by page_map lookups (which are indexed
    # against the raw markdown).
    q_tight = normalize_tight(quote)
    results = _find_all(markdown, q_tight, "tight")
    if results:
        return results

    # Loose: strip visual macros from both sides, then search.
    q_loose = normalize_loose(quote)
    if q_loose and q_loose != q_tight:
        md_loose = _LOOSE_STRIP_RE.sub(r"\1", markdown)
        # We can only trust offsets from the stripped markdown to map back
        # when the strip is a pure character-deletion. Since the regex
        # replaces `\mathbf{X}` with `X`, char indices in md_loose do NOT
        # correspond to the same chars in `markdown`. So loose search is
        # best-effort: we return matches against md_loose with the
        # `loose` flag, and the caller's page_map lookup must also operate
        # on the loose projection (handled by `bbox_for_occurrence`).
        loose_hits = _find_all(md_loose, q_loose, "loose")
        results.extend(loose_hits)
    return results


def _find_all(haystack: str, needle: str, normalization: Literal["tight", "loose"]) -> List[Occurrence]:
    out: List[Occurrence] = []
    start = 0
    n = len(needle)
    if n == 0:
        return out
    while True:
        idx = haystack.find(needle, start)
        if idx < 0:
            return out
        out.append(Occurrence(offset=idx, length=n, normalization=normalization))
        start = idx + 1


# ---------------------------------------------------------------------------
# Ranking (parent-block-constrained)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class RankedMatch:
    occurrence: Occurrence
    confidence: AnchorConfidence
    distance: int  # char distance from parent block start (0 if inside)


# Ambiguity classification — used by localize_finding to decide whether to
# escalate to tier-3 vision disambiguation. Also logged on every multi-match
# finding so a fixture run can measure how often "loose" would differ from
# "strict" triggering.
AmbiguityCategory = Literal[
    "single",             # one total match overall — never ambiguous
    "single_in_parent",   # one match inside parent, others outside  (strict=skip, loose=escalate)
    "multi_in_parent",    # multiple matches inside parent           (always escalate)
    "all_outside_parent", # zero inside parent, ≥1 outside           (always escalate)
    "none",               # zero matches anywhere
]


@dataclass(frozen=True)
class MatchReport:
    """Full classification of the match set for a given quote + parent block.

    `best` is the deterministic pick (same as old rank_by_parent). `category`
    drives vision escalation. `inside_count` / `outside_count` are logged.
    """
    best: Optional[RankedMatch]
    category: AmbiguityCategory
    inside_count: int
    outside_count: int
    # Candidate occurrences outside the parent block, sorted by distance.
    # Used by tier-3 disambiguator when it needs to compare multiple candidates.
    outside_candidates: List[Occurrence]


def classify_matches(
    matches: List[Occurrence],
    parent_char_start: Optional[int],
    parent_char_end: Optional[int],
) -> MatchReport:
    """Classify the match set and pick the deterministic best candidate.

    Ranking for `best` is the same as the old rank_by_parent: prefer tight
    matches inside the parent block, then tight outside, then loose inside,
    then loose outside. The category reflects *where* the tight matches fall
    (loose matches don't contribute to the inside/outside counts because
    their offsets are approximate and not meaningful for escalation).
    """
    have_parent = parent_char_start is not None and parent_char_end is not None

    def is_inside(o: Occurrence) -> bool:
        if not have_parent or o.normalization != "tight":
            return False
        return parent_char_start <= o.offset < parent_char_end

    tight = [o for o in matches if o.normalization == "tight"]
    inside = [o for o in tight if is_inside(o)]
    outside = [o for o in tight if not is_inside(o)]

    best = rank_by_parent(matches, parent_char_start, parent_char_end)

    if not matches:
        category: AmbiguityCategory = "none"
    elif len(tight) == 0:
        # Only loose matches — treat as ambiguous-ish; caller can pick its policy.
        category = "single" if len(matches) == 1 else "all_outside_parent"
    elif len(tight) == 1:
        category = "single"
    elif len(inside) >= 2:
        category = "multi_in_parent"
    elif len(inside) == 1 and len(outside) >= 1:
        category = "single_in_parent"
    else:
        category = "all_outside_parent"

    return MatchReport(
        best=best,
        category=category,
        inside_count=len(inside),
        outside_count=len(outside),
        outside_candidates=outside,
    )


def rank_by_parent(
    matches: List[Occurrence],
    parent_char_start: Optional[int],
    parent_char_end: Optional[int],
) -> Optional[RankedMatch]:
    """Pick the best match, preferring occurrences inside the parent block.

    Ranking:
      1. inside parent block + tight   → exact_in_block
      2. outside parent block + tight  → exact_near_block (nearest)
      3. inside parent block + loose   → fuzzy_in_block
      4. outside parent block + loose  → fuzzy_far
      5. no matches                    → None
    """
    if not matches:
        return None

    have_parent = parent_char_start is not None and parent_char_end is not None

    def inside(o: Occurrence) -> bool:
        if not have_parent:
            return False
        return parent_char_start <= o.offset < parent_char_end

    def distance(o: Occurrence) -> int:
        if not have_parent:
            return 0
        if inside(o):
            return 0
        return min(abs(o.offset - parent_char_start), abs(o.offset - parent_char_end))

    tight = [o for o in matches if o.normalization == "tight"]
    loose = [o for o in matches if o.normalization == "loose"]

    if tight:
        inside_tight = [o for o in tight if inside(o)]
        if inside_tight:
            best = min(inside_tight, key=distance)
            return RankedMatch(best, "exact_in_block", 0)
        best = min(tight, key=distance)
        return RankedMatch(best, "exact_near_block", distance(best))

    if loose:
        inside_loose = [o for o in loose if inside(o)]
        if inside_loose:
            best = min(inside_loose, key=distance)
            return RankedMatch(best, "fuzzy_in_block", 0)
        best = min(loose, key=distance)
        return RankedMatch(best, "fuzzy_far", distance(best))

    return None


# ---------------------------------------------------------------------------
# Bbox resolution via page_map
# ---------------------------------------------------------------------------

def page_for_offset(page_map: List[PageMapEntry], offset: int) -> Optional[int]:
    for entry in page_map:
        if entry.char_start <= offset < entry.char_end:
            return entry.page
    return page_map[-1].page if page_map else None


def section_for_offset(page_map: List[PageMapEntry], offset: int) -> Optional[str]:
    for entry in page_map:
        if entry.char_start <= offset < entry.char_end:
            return entry.section
    return None


def bbox_for_offset(page_map: List[PageMapEntry], offset: int) -> Optional[BoundingBox]:
    for entry in page_map:
        if entry.char_start <= offset < entry.char_end:
            return entry.bbox
    return None


def bbox_for_range(
    page_map: List[PageMapEntry],
    char_start: int,
    char_end: int,
) -> Optional[tuple[int, BoundingBox]]:
    """Return (primary_page, unioned_bbox) for the given char range.

    - Collects every page_map entry overlapping [char_start, char_end).
    - Groups by page. Primary page = the page containing the majority of
      the range's chars.
    - Unions the bboxes on the primary page into a single rectangle.
    - Returns None if no overlapping entry has a bbox.
    """
    if char_end <= char_start:
        return None

    # Pair: (page, char_coverage_in_that_page, bbox_or_none)
    coverage_by_page: dict[int, int] = {}
    bboxes_by_page: dict[int, list[BoundingBox]] = {}
    for entry in page_map:
        overlap_start = max(entry.char_start, char_start)
        overlap_end = min(entry.char_end, char_end)
        if overlap_end <= overlap_start:
            continue
        coverage_by_page[entry.page] = coverage_by_page.get(entry.page, 0) + (overlap_end - overlap_start)
        if entry.bbox is not None:
            bboxes_by_page.setdefault(entry.page, []).append(entry.bbox)

    if not coverage_by_page:
        return None

    primary_page = max(coverage_by_page.items(), key=lambda kv: kv[1])[0]
    primary_boxes = bboxes_by_page.get(primary_page, [])
    if not primary_boxes:
        return None

    return primary_page, _union_bboxes(primary_page, primary_boxes)


def _union_bboxes(page: int, boxes: List[BoundingBox]) -> BoundingBox:
    """Axis-aligned union in PDF-native coords. All boxes must be on same page."""
    x0 = min(b.x for b in boxes)
    y0 = min(b.y for b in boxes)
    x1 = max(b.x + b.width for b in boxes)
    y1 = max(b.y + b.height for b in boxes)
    return BoundingBox(
        page=page,
        x=x0,
        y=y0,
        width=max(x1 - x0, 1.0),
        height=max(y1 - y0, 1.0),
    )


# ---------------------------------------------------------------------------
# Legacy / light-weight locator retained for extract_proofs
# ---------------------------------------------------------------------------

def locate_legacy(markdown: str, text: str, label: Optional[str], after: int = 0) -> int:
    """Original proof-block locator, preserved for extract_proofs.py.

    Tries exact substring → first-line anchor → label + short prefix. Returns
    char offset or -1.
    """
    if not text:
        return -1

    idx = markdown.find(text, after)
    if idx >= 0:
        return idx

    anchor = text[:120].strip()
    if anchor:
        idx = markdown.find(anchor, after)
        if idx >= 0:
            return idx

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
