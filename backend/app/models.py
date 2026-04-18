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


class Paper(BaseModel):
    paper_id: str = Field(default_factory=_uuid)
    filename: str
    title: Optional[str] = None

    status: PaperStatus = PaperStatus.analyzing
    step: PipelineStep = PipelineStep.parse
    step_index: int = 0
    error_code: Optional[str] = None
    error_message: Optional[str] = None

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
# Error envelope
# ---------------------------------------------------------------------------

class ErrorBody(BaseModel):
    code: str
    message: str
    detail: Optional[Dict] = None


class ErrorEnvelope(BaseModel):
    error: ErrorBody
