from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uuid() -> str:
    return str(uuid4())


# ---------------------------------------------------------------------------
# Enums — locked by backend/frontend contract
# ---------------------------------------------------------------------------

class PaperStatus(str, Enum):
    analyzing = "analyzing"
    ready = "ready"
    failed = "failed"


class RunState(str, Enum):
    idle = "idle"              # uploaded, no run started
    planning = "planning"      # outline + segment plan being built
    running = "running"        # scheduler actively processing segments
    paused = "paused"          # user hit stop; current segment finishing
    stopped = "stopped"        # halted, resumable
    completed = "completed"
    failed = "failed"


class SegmentClassification(str, Enum):
    proof = "proof"
    theorem = "theorem"
    background = "background"
    experiment = "experiment"
    figures = "figures"
    other = "other"


class SegmentStatus(str, Enum):
    pending = "pending"
    parsing = "parsing"
    extracting = "extracting"
    verifying = "verifying"
    localizing = "localizing"
    done = "done"
    skipped = "skipped"
    failed = "failed"
    stopped = "stopped"


class PageAnalysisStatus(str, Enum):
    """Per-page state the UI shows on the thumbnail strip."""
    queued = "queued"
    scanning = "scanning"
    done = "done"
    skipped = "skipped"
    failed = "failed"


class PipelineStep(str, Enum):
    parse = "parse"
    extract_proofs = "extract_proofs"
    verify_proofs = "verify_proofs"
    ready = "ready"
    failed = "failed"


PIPELINE_ORDER: List[PipelineStep] = [
    PipelineStep.parse,
    PipelineStep.extract_proofs,
    PipelineStep.verify_proofs,
]


class ProofKind(str, Enum):
    theorem = "theorem"
    lemma = "lemma"
    proposition = "proposition"
    corollary = "corollary"
    claim = "claim"
    proof = "proof"


class IssueType(str, Enum):
    arithmetic = "arithmetic"
    logic = "logic"
    unstated_assumption = "unstated_assumption"
    wrong_constant = "wrong_constant"
    quantifier_scope = "quantifier_scope"
    citation_required = "citation_required"
    definition_mismatch = "definition_mismatch"
    missing_step = "missing_step"
    other = "other"


class Severity(str, Enum):
    high = "high"
    medium = "medium"
    low = "low"


class FindingDecision(str, Enum):
    agree = "agree"
    dismiss = "dismiss"


class LocalizeStatus(str, Enum):
    pending = "pending"
    done = "done"                      # deterministic anchor + (optional) vision presence confirmed
    approximate = "approximate"        # deterministic candidate, block-level, not line-precise
    not_located = "not_located"        # no candidate — finding still visible, no PDF rectangle
    user_placed = "user_placed"        # reviewer drew the bbox manually
    quote_unverified = "quote_unverified"  # evidence_quote not found in markdown at all
    # deprecated — retained in the enum only to deserialize pre-v1 papers
    dropped = "dropped"


class ExchangeRole(str, Enum):
    user = "user"
    assistant = "assistant"


# ---------------------------------------------------------------------------
# v2 review-flow enums (triage → deep dive → multi-dimensional scoring)
# ---------------------------------------------------------------------------

class VenueType(str, Enum):
    journal = "journal"
    conference = "conference"
    grant = "grant"          # NSF / NIH / etc.
    thesis = "thesis"
    other = "other"


class Dimension(str, Enum):
    proof = "proof"
    literature = "literature"
    clarity = "clarity"
    numerical = "numerical"
    relevance = "relevance"
    novelty = "novelty"


class TriageVerdict(str, Enum):
    high = "high"      # worth deep diving
    medium = "medium"
    low = "low"


class ReviewStage(str, Enum):
    uploaded = "uploaded"     # no triage yet
    triaging = "triaging"
    triaged = "triaged"       # triage done, no dive yet
    diving = "diving"         # deep dive in progress
    dived = "dived"           # deep dive complete


class PaperFlag(str, Enum):
    """v3 user flag — orthogonal to `stage`. A paper can be flagged at any
    point in its lifecycle. `None` = unflagged (the default)."""
    promising = "promising"
    rejected = "rejected"


# ---------------------------------------------------------------------------
# Core data objects
# ---------------------------------------------------------------------------

class BoundingBox(BaseModel):
    page: int = Field(ge=1)
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class PageMapEntry(BaseModel):
    """One row in the markdown → PDF page index.

    Maps a slice of the rendered markdown (char_start:char_end) to the PDF page
    and, when MinerU supplies it, to the block's bounding box on that page.
    """
    page: int = Field(ge=1)
    block_type: str  # text | heading | equation | table | figure_caption
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)
    bbox: Optional[BoundingBox] = None
    section: Optional[str] = None


class ProofBlock(BaseModel):
    proof_block_id: str = Field(default_factory=_uuid)
    kind: ProofKind
    label: Optional[str] = None   # "Lemma 1", "Theorem 3.2", etc.
    statement: str
    body: str = ""                # the proof text, if any (empty for pure statements)
    page_hint: int = Field(ge=1)
    section: Optional[str] = None
    char_start: int = Field(ge=0)
    char_end: int = Field(ge=0)
    bbox: Optional[BoundingBox] = None  # coarse, from MinerU


class Exchange(BaseModel):
    exchange_id: str = Field(default_factory=_uuid)
    role: ExchangeRole
    content: str
    created_at: str = Field(default_factory=_utc_now)


class Finding(BaseModel):
    finding_id: str = Field(default_factory=_uuid)
    proof_block_id: str
    issue_type: IssueType
    severity: Severity
    confidence: float = Field(ge=0.0, le=1.0)
    description: str              # 1-3 sentence AI reasoning
    evidence_quote: str           # exact quoted passage from the markdown
    page: int = Field(ge=1)
    bbox: Optional[BoundingBox] = None
    localize_status: LocalizeStatus = LocalizeStatus.pending
    visually_verified: bool = False
    # Provenance of the bbox — drives frontend rendering state (solid vs dashed,
    # tag copy, whether the manual-placement affordance is offered).
    bbox_source: Optional[str] = None  # "page_map_single" | "page_map_union" | "vision_verified" | "user_placed" | "missing"
    location_confidence: Optional[int] = None  # 0..100
    anchor_confidence: Optional[str] = None    # exact_in_block | exact_near_block | fuzzy_in_block | fuzzy_far | none
    # Cache key: bboxes are only valid for the parse_version they were computed against.
    parse_version: Optional[str] = None
    decision: Optional[FindingDecision] = None
    decision_note: Optional[str] = None
    exchanges: List[Exchange] = Field(default_factory=list)
    soft_deleted: bool = False
    created_at: str = Field(default_factory=_utc_now)
    # v2: which review dimension this finding contributes to. Defaults to
    # "proof" so legacy data (verify_proofs output) deserializes without a
    # migration touching every record.
    dimension: Dimension = Dimension.proof


class ReviewDraft(BaseModel):
    draft_id: str = Field(default_factory=_uuid)
    markdown: str
    created_at: str = Field(default_factory=_utc_now)
    updated_at: str = Field(default_factory=_utc_now)


# ---------------------------------------------------------------------------
# v2 review-flow data objects
# ---------------------------------------------------------------------------

class TriageReport(BaseModel):
    """Output of the upload-time triage pass. Drives the H/M/L badge and the
    "Dive Deep" decision in the workspace shell."""
    scope: str                       # 1-2 sentences: what does the paper claim?
    novelty: str                     # 2-3 sentences vs prior work
    venue_match: str                 # 1-2 sentences re fit to declared venue
    summary: str                     # 3-4 sentences review-summary preview
    verdict: TriageVerdict
    confidence: float = Field(ge=0.0, le=1.0)
    cost_usd: float = 0.0
    generated_at: str = Field(default_factory=_utc_now)


class DimensionScore(BaseModel):
    """One axis of the per-paper score. Six instances populate the radar.

    `score` is the LLM-emitted base value 0..10; the frontend applies the
    decision-driven adjustment (§3.3 of the v2 plan) live as the user
    agrees/dismisses findings. Server re-applies the same formula at
    finalize-review time and freezes the result on Paper.final_score.
    """
    dimension: Dimension
    score: float = Field(ge=0.0, le=10.0)
    rationale: str                                # 1-2 sentences
    finding_ids: List[str] = Field(default_factory=list)


class ReviewStyleSnapshot(BaseModel):
    """Style choices captured at upload time. Mirrors frontend ReviewConfig
    (which is shaped like the existing /review/generate body). Persisted on
    the paper so finalize-review can reproduce the same voice without
    requiring the user to re-pick."""
    field: Optional[str] = None
    style: Optional[str] = None       # rigorous_skeptical | constructive_mentoring | terse_expert
    tone: Optional[str] = None        # formal | neutral | casual
    length: Optional[str] = None      # short | standard | thorough
    sections: Optional[List[str]] = None


class Segment(BaseModel):
    """One analyzable slice of the paper. Backend execution unit.

    The user doesn't see `Segment` directly — they see per-page status via
    PageAnalysisStatus derived from this list. A segment always covers a
    contiguous page range and carries its own cost attribution.
    """
    segment_id: str = Field(default_factory=_uuid)
    page_start: int = Field(ge=1)
    page_end: int = Field(ge=1)                       # inclusive
    label: str                                         # "Proofs §4", "Experiments"
    classification: SegmentClassification
    priority: int                                      # 0 = skip, higher = sooner
    status: SegmentStatus = SegmentStatus.pending

    started_at: Optional[str] = None
    finished_at: Optional[str] = None

    # Attribution to results
    proof_block_ids: List[str] = Field(default_factory=list)
    finding_ids: List[str] = Field(default_factory=list)

    # Cost tracking (raw, before markup)
    llm_cost_usd: float = 0.0
    gpu_seconds: float = 0.0
    gpu_cost_usd: float = 0.0

    def cost_subtotal_usd(self) -> float:
        return round(self.llm_cost_usd + self.gpu_cost_usd, 4)


class Paper(BaseModel):
    paper_id: str = Field(default_factory=_uuid)
    filename: str
    title: Optional[str] = None
    page_count: int = 0

    status: PaperStatus = PaperStatus.analyzing
    step: PipelineStep = PipelineStep.parse
    step_index: int = 0
    error_code: Optional[str] = None
    error_message: Optional[str] = None

    # Segmented pipeline state
    run_state: RunState = RunState.idle
    segments: List[Segment] = Field(default_factory=list)
    pricing_snapshot: Optional[Dict] = None

    # Stable "what the verifier should know about the whole paper" digest.
    # Built once after planning (PyMuPDF text-extract of the non-proof
    # classified segments). Used as the CACHEABLE part of verify_proofs
    # prompts so the growing paper.markdown doesn't break the cache.
    stable_digest: str = ""

    # Pipeline outputs (accumulated across all segments)
    markdown: str = ""
    page_map: List[PageMapEntry] = Field(default_factory=list)
    proof_blocks: List[ProofBlock] = Field(default_factory=list)
    findings: List[Finding] = Field(default_factory=list)
    review_drafts: List[ReviewDraft] = Field(default_factory=list)

    # Bumped after every successful parse step. Used as a cache key for
    # finding bboxes: if finding.parse_version != paper.parse_version, the
    # bbox is stale and localize must re-run.
    parse_version: str = Field(default_factory=_uuid)

    created_at: str = Field(default_factory=_utc_now)
    updated_at: str = Field(default_factory=_utc_now)

    # ---------- v2: triage → deep dive → multi-dimensional scoring ----------
    # Captured at upload; defaults keep legacy papers loadable.
    venue_type: VenueType = VenueType.journal
    venue_name: Optional[str] = None              # "JASA", "NeurIPS", "NSF DMS"
    # v3: folder is now optional. Papers without a folder show under "All"
    # in the sidebar. The default seed/migration moves legacy `Inbox` → None.
    folder: Optional[str] = None                   # logical grouping for library list
    review_style: Optional[ReviewStyleSnapshot] = None
    # Two-stage flow state.
    triage: Optional[TriageReport] = None
    stage: ReviewStage = ReviewStage.uploaded
    # Per-dimension base scores from the deep-dive passes. Frontend applies
    # the decision-driven adjustment live; backend re-derives at finalize.
    dimension_scores: List[DimensionScore] = Field(default_factory=list)
    # Frozen aggregate after finalize-review. None until then.
    final_score: Optional[float] = None

    # v3: user flag — Promising / Rejected status, orthogonal to `stage`.
    # At most one at a time (set-clears-the-other), per the spec.
    flag: Optional[PaperFlag] = None

    # -- helpers -----------------------------------------------------------
    def finding(self, finding_id: str) -> Optional[Finding]:
        for f in self.findings:
            if f.finding_id == finding_id:
                return f
        return None

    def draft(self, draft_id: str) -> Optional[ReviewDraft]:
        for d in self.review_drafts:
            if d.draft_id == draft_id:
                return d
        return None

    def segment(self, segment_id: str) -> Optional[Segment]:
        for s in self.segments:
            if s.segment_id == segment_id:
                return s
        return None

    def total_llm_cost_raw(self) -> float:
        return round(sum(s.llm_cost_usd for s in self.segments), 6)

    def total_gpu_cost_raw(self) -> float:
        return round(sum(s.gpu_cost_usd for s in self.segments), 6)

    def total_cost_raw(self) -> float:
        return round(self.total_llm_cost_raw() + self.total_gpu_cost_raw(), 6)

    def page_status(self, page: int) -> PageAnalysisStatus:
        """Translate segment status into a single per-page status for the UI."""
        for seg in self.segments:
            if seg.page_start <= page <= seg.page_end:
                if seg.status == SegmentStatus.done:
                    return PageAnalysisStatus.done
                if seg.status == SegmentStatus.skipped:
                    return PageAnalysisStatus.skipped
                if seg.status == SegmentStatus.failed:
                    return PageAnalysisStatus.failed
                if seg.status in (
                    SegmentStatus.parsing, SegmentStatus.extracting,
                    SegmentStatus.verifying, SegmentStatus.localizing,
                ):
                    return PageAnalysisStatus.scanning
                return PageAnalysisStatus.queued
        return PageAnalysisStatus.queued


# ---------------------------------------------------------------------------
# API request / response shapes
# ---------------------------------------------------------------------------

class PaperSummary(BaseModel):
    paper_id: str
    filename: str
    title: Optional[str] = None
    status: PaperStatus
    step: PipelineStep
    step_index: int
    finding_count: int
    decided_count: int
    created_at: str
    # v2 fields — included so the library can render badges + folders without
    # a second round-trip per paper. Optional to keep legacy summaries valid.
    venue_type: Optional[VenueType] = None
    venue_name: Optional[str] = None
    folder: Optional[str] = None
    stage: Optional[ReviewStage] = None
    triage_verdict: Optional[TriageVerdict] = None
    final_score: Optional[float] = None
    # v3 flag — surfaced for status-folder counts (Promising/Rejected) on the
    # library sidebar. Frontend filters the list client-side from this field.
    flag: Optional[PaperFlag] = None


class PaperStatusResponse(BaseModel):
    status: PaperStatus
    step: PipelineStep
    step_index: int
    total_steps: int = len(PIPELINE_ORDER)
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    finding_count: int = 0
    localize_pending: int = 0


class DecideRequest(BaseModel):
    decision: FindingDecision
    note: Optional[str] = None


class InvestigateRequest(BaseModel):
    message: str


class PlaceRequest(BaseModel):
    """Manual bbox placement. Coordinates are PDF-native (bottom-left origin, points)."""
    page: int = Field(ge=1)
    bbox: BoundingBox


class ReviewGenerateRequest(BaseModel):
    # Reviewer persona knobs. All optional — when omitted, the prompt falls
    # back to a rigorous-skeptical default so the one-click path still works.
    field: Optional[str] = None                 # e.g. "Statistics", "ML theory", or free text
    style: Optional[str] = None                 # "rigorous_skeptical" | "constructive_mentoring" | "terse_expert"
    tone: Optional[str] = None                  # "formal" | "neutral" | "casual"
    length: Optional[str] = None                # "short" | "standard" | "thorough"
    sections: Optional[List[str]] = None        # subset of {summary, strengths, weaknesses, detailed, questions, minor}
    venue: Optional[str] = None                 # kept for forward-compat (not surfaced in UI yet)


class ReviewPatchRequest(BaseModel):
    markdown: str


class FolderPatchRequest(BaseModel):
    """PATCH /papers/{id}/folder — move a paper into a different folder, or
    pass null to remove it from any folder (paper shows under 'All')."""
    folder: Optional[str] = None


class FlagPatchRequest(BaseModel):
    """POST /papers/{id}/flag. Setting promising/rejected clears the
    opposite; passing null clears the current flag."""
    flag: Optional[PaperFlag] = None


# ---------------------------------------------------------------------------
# v3: folders + onboarding
# ---------------------------------------------------------------------------

class Folder(BaseModel):
    """User-defined folder for grouping papers in the library sidebar.

    Stored on disk (data/folders.json) — replaces the v2 hardcoded list.
    `is_default` folders are seeded at startup or by onboarding and cannot
    be deleted (frontend can rename them).
    """
    name: str                           # canonical key, case-sensitive
    venue_type: Optional[VenueType] = None  # cosmetic icon hint
    created_at: str = Field(default_factory=_utc_now)
    is_default: bool = False


class FolderCreateRequest(BaseModel):
    name: str
    venue_type: Optional[VenueType] = None


class FolderPatchBodyRequest(BaseModel):
    """PATCH /v1/folders/{name} — rename and/or change icon hint."""
    name: Optional[str] = None
    venue_type: Optional[VenueType] = None


class OnboardingProfile(BaseModel):
    """v3 user profile captured on first visit. Single-user MVP — one
    record at data/profile.json. When auth lands, key by user_id.

    `name` is retained for forward compatibility but the v3 frontend no
    longer collects it (privacy) — sends "Anonymous". Drop in a future
    schema rev once auth replaces the personal field.
    """
    name: str = "Anonymous"
    role: str                            # v3: "Title" — Faculty / Postdoc / PhD candidate / ...
    field: str                           # "Statistics", "ML theory", ...
    research_interests: List[str] = Field(default_factory=list)
    default_venues: List[str] = Field(default_factory=list)
    default_review_style: ReviewStyleSnapshot
    completed_at: str = Field(default_factory=_utc_now)


class OnboardingRequest(BaseModel):
    """POST body for /v1/onboarding. `completed_at` is server-stamped, not
    accepted from the client."""
    name: str = "Anonymous"
    role: str
    field: str
    research_interests: List[str] = Field(default_factory=list)
    default_venues: List[str] = Field(default_factory=list)
    default_review_style: ReviewStyleSnapshot


# ---------------------------------------------------------------------------
# v3 batch
# ---------------------------------------------------------------------------

class BatchAction(str, Enum):
    dive_deep = "dive_deep"
    flag = "flag"
    set_folder = "set_folder"
    delete = "delete"


class BatchRequest(BaseModel):
    """POST /v1/papers/batch. `payload` is action-specific:
        dive_deep   → {} (ignored)
        flag        → {"flag": "promising"|"rejected"|null}
        set_folder  → {"folder": "<name>"|null}
        delete      → {} (ignored)
    """
    ids: List[str]
    action: BatchAction
    payload: Dict = Field(default_factory=dict)


class BatchResultItem(BaseModel):
    paper_id: str
    ok: bool
    skipped: bool = False
    error: Optional[str] = None


class BatchResultSummary(BaseModel):
    ok: int
    failed: int


class BatchResponse(BaseModel):
    results: List[BatchResultItem]
    summary: BatchResultSummary


class ScoresResponse(BaseModel):
    """GET /papers/{id}/scores. Frontend renders the radar from this."""
    dimensions: List[DimensionScore]
    aggregate: float = Field(ge=0.0, le=10.0)
    frozen: bool


class FinalizeReviewResponse(BaseModel):
    """POST /papers/{id}/finalize-review — freezes score + generates draft."""
    aggregate: float
    draft_id: str


class ReviewDraftSummary(BaseModel):
    """Lightweight shape for the drafts-list UI. Omits full markdown."""
    draft_id: str
    created_at: str
    updated_at: str
    word_count: int
    preview: str  # first ~140 chars of body, stripped of markdown headings


# ---------------------------------------------------------------------------
# Cost report
# ---------------------------------------------------------------------------

class SegmentCostBreakdown(BaseModel):
    segment_id: str
    label: str
    page_start: int
    page_end: int
    classification: SegmentClassification
    status: SegmentStatus
    llm_cost_usd: float
    gpu_cost_usd: float
    cost_subtotal_usd: float


class CostReport(BaseModel):
    # current running cost (pre-markup, everything accumulated so far)
    running_raw_usd: float
    running_billed_usd: float
    # what we project for the remaining pending segments
    estimate_remaining_raw_usd: float
    estimate_total_raw_usd: float
    estimate_total_billed_usd: float
    # markup snapshot
    markup_factor: float
    # breakdowns
    by_stage: Dict[str, float]           # llm breakdown by pipeline tag
    by_segment: List[SegmentCostBreakdown]
    llm_tokens: Dict[str, int]
    formula_url: str = "/source/pricing.py"


# ---------------------------------------------------------------------------
# Outline / segment planning (LLM response shape)
# ---------------------------------------------------------------------------

class OutlineHeading(BaseModel):
    """One candidate heading from local PDF scan (PyMuPDF)."""
    page: int
    text: str
    level: int = 1
    font_size: Optional[float] = None


# ---------------------------------------------------------------------------
# Error envelope
# ---------------------------------------------------------------------------

class ErrorBody(BaseModel):
    code: str
    message: str
    detail: Optional[Dict] = None


class ErrorEnvelope(BaseModel):
    error: ErrorBody
