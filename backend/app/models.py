from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional
from uuid import uuid4

from pydantic import BaseModel, Field


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class PaperStatus(str, Enum):
    uploading = "uploading"
    parsing = "parsing"
    analyzing = "analyzing"
    ready = "ready"
    error = "error"


class FindingDecision(str, Enum):
    agree = "agree"
    dismiss = "dismiss"
    investigate = "investigate"


class PipelineStep(str, Enum):
    parse = "parse"
    survey = "survey"
    examine = "examine"
    compare = "compare"
    verdict = "verdict"


class VenueType(str, Enum):
    iclr = "iclr"
    neurips = "neurips"
    jasa = "jasa"
    nsf_proposal = "nsf_proposal"
    technical_report = "technical_report"
    other = "other"


class ReviewStyle(str, Enum):
    concise = "concise"
    normal = "normal"


class ReviewTone(str, Enum):
    casual = "casual"
    formal = "formal"


class LLMModel(str, Enum):
    claude_sonnet = "claude-sonnet-4-6"
    claude_opus = "claude-opus-4-6"
    gpt_4_1 = "gpt-4.1"
    deepseek_v3 = "deepseek-v3"
    kimi_k2_5 = "kimi-k2.5"
    minimax_m2_7 = "minimax-m2.7"


# ---------------------------------------------------------------------------
# Core data objects
# ---------------------------------------------------------------------------

class BoundingBox(BaseModel):
    page: int = Field(ge=1)
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class ParsedBlock(BaseModel):
    block_id: str = Field(default_factory=lambda: str(uuid4()))
    block_type: str  # text, equation, figure_caption, table, heading
    content: str
    page: int
    bbox: BoundingBox


class Finding(BaseModel):
    finding_id: str = Field(default_factory=lambda: str(uuid4()))
    label: str
    reasoning: str
    bbox: BoundingBox
    source_block_ids: List[str] = Field(default_factory=list)
    pipeline_step: PipelineStep = PipelineStep.examine
    decision: Optional[FindingDecision] = None
    decision_comment: Optional[str] = None
    soft_deleted: bool = False
    created_at: str = Field(default_factory=utc_now_iso)


class Exchange(BaseModel):
    exchange_id: str = Field(default_factory=lambda: str(uuid4()))
    finding_id: str
    user_direction: str
    ai_response: str
    decision: Optional[FindingDecision] = None
    decision_comment: Optional[str] = None
    created_at: str = Field(default_factory=utc_now_iso)


class PipelineState(BaseModel):
    current_step: Optional[PipelineStep] = None
    completed_steps: List[PipelineStep] = Field(default_factory=list)
    error: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None


class Paper(BaseModel):
    paper_id: str = Field(default_factory=lambda: str(uuid4()))
    user_id: str = ""
    filename: str = ""
    title: Optional[str] = None
    status: PaperStatus = PaperStatus.uploading
    model: LLMModel = LLMModel.claude_opus
    pipeline_state: PipelineState = Field(default_factory=PipelineState)
    parsed_blocks: List[ParsedBlock] = Field(default_factory=list)
    survey_summary: Optional[str] = None
    findings: List[Finding] = Field(default_factory=list)
    exchanges: List[Exchange] = Field(default_factory=list)
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)


# ---------------------------------------------------------------------------
# User profile
# ---------------------------------------------------------------------------

class LearnedRule(BaseModel):
    rule_id: str = Field(default_factory=lambda: str(uuid4()))
    rule_text: str
    source_finding_id: Optional[str] = None
    source_decision: Optional[FindingDecision] = None
    created_at: str = Field(default_factory=utc_now_iso)


class UserProfile(BaseModel):
    user_id: str = Field(default_factory=lambda: str(uuid4()))
    display_name: str = ""
    focus_areas: List[str] = Field(default_factory=list)
    learned_rules: List[LearnedRule] = Field(default_factory=list)
    onboarding_completed: bool = False
    custom_style_prompts: Dict[str, str] = Field(default_factory=dict)
    custom_tone_prompts: Dict[str, str] = Field(default_factory=dict)
    custom_review_templates: Dict[str, dict] = Field(default_factory=dict)
    created_at: str = Field(default_factory=utc_now_iso)


# ---------------------------------------------------------------------------
# API request / response models
# ---------------------------------------------------------------------------

class PaperSummaryResponse(BaseModel):
    paper_id: str
    filename: str
    title: Optional[str] = None
    status: PaperStatus
    finding_count: int = 0
    reviewed_count: int = 0
    created_at: str


class PaperDetailResponse(BaseModel):
    paper_id: str
    user_id: str
    filename: str
    title: Optional[str] = None
    status: PaperStatus
    model: LLMModel
    pipeline_state: PipelineState
    findings: List[Finding]
    exchanges: List[Exchange]
    survey_summary: Optional[str] = None
    created_at: str
    updated_at: str


class FindingDecisionRequest(BaseModel):
    decision: FindingDecision
    comment: Optional[str] = None


class InvestigateRequest(BaseModel):
    direction: str


class ExchangeDecisionRequest(BaseModel):
    decision: FindingDecision
    comment: Optional[str] = None


class RerunRequest(BaseModel):
    focus_areas: Optional[List[str]] = None


class DraftReviewRequest(BaseModel):
    venue: VenueType
    style: ReviewStyle = ReviewStyle.normal
    tone: ReviewTone = ReviewTone.formal
    custom_style_prompt: Optional[str] = None
    custom_tone_prompt: Optional[str] = None
    template_override: Optional[dict] = None


class DraftReviewResponse(BaseModel):
    review_markdown: str
    review_sections: Dict[str, str] = Field(default_factory=dict)
    venue: VenueType


class OnboardingRequest(BaseModel):
    display_name: str
    research_domain: str = ""
    focus_areas: List[str] = Field(default_factory=list)


class UpdateProfileRequest(BaseModel):
    display_name: Optional[str] = None
    focus_areas: Optional[List[str]] = None
