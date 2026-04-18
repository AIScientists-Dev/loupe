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
    done = "done"
    dropped = "dropped"


class ExchangeRole(str, Enum):
    user = "user"
    assistant = "assistant"


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
    decision: Optional[FindingDecision] = None
    decision_note: Optional[str] = None
    exchanges: List[Exchange] = Field(default_factory=list)
    soft_deleted: bool = False
    created_at: str = Field(default_factory=_utc_now)


class ReviewDraft(BaseModel):
    draft_id: str = Field(default_factory=_uuid)
    markdown: str
    created_at: str = Field(default_factory=_utc_now)
    updated_at: str = Field(default_factory=_utc_now)


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

    # Pipeline outputs (accumulated across all segments)
    markdown: str = ""
    page_map: List[PageMapEntry] = Field(default_factory=list)
    proof_blocks: List[ProofBlock] = Field(default_factory=list)
    findings: List[Finding] = Field(default_factory=list)
    review_drafts: List[ReviewDraft] = Field(default_factory=list)

    created_at: str = Field(default_factory=_utc_now)
    updated_at: str = Field(default_factory=_utc_now)

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


class ReviewGenerateRequest(BaseModel):
    # placeholder knobs — kept minimal for prototype
    venue: Optional[str] = None
    tone: Optional[str] = None
    length: Optional[str] = None


class ReviewPatchRequest(BaseModel):
    markdown: str


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
