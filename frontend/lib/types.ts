// Types mirror the locked Loupe API contract.
// Keep in sync with backend/app/models.py.

export type PaperStatus =
  | "analyzing"
  | "parsed"
  | "proofs_extracted"
  | "ready"
  | "failed";

export type PipelineStep =
  | "parse"
  | "extract_proofs"
  | "verify_proofs"
  | "ready"
  | "failed";

export type RunState =
  | "idle"
  | "running"
  | "paused"
  | "stopped"
  | "completed";

export type SegmentClassification =
  | "proof"
  | "theorem"
  | "background"
  | "experiment"
  | "figures"
  | "other";

export type SegmentStatus =
  | "pending"
  | "parsing"
  | "extracting"
  | "verifying"
  | "localizing"
  | "done"
  | "skipped"
  | "failed"
  | "stopped";

export interface Segment {
  segment_id: string;
  page_start: number;
  page_end: number;
  label: string;
  classification: SegmentClassification;
  priority: number;
  status: SegmentStatus;
  proof_block_ids: string[];
  finding_ids: string[];
  cost_subtotal_usd: number;
  mineru_eta_seconds?: number;
  mineru_seconds_per_page_estimate?: number;
  started_at?: string;
  finished_at?: string;
}

export interface CostSegmentBreakdown {
  segment_id: string;
  label: string;
  page_start: number;
  page_end: number;
  classification: string;
  status: string;
  llm_cost_usd: number;
  gpu_cost_usd: number;
  cost_subtotal_usd: number;
}

export interface CostReport {
  running_raw_usd: number;
  running_billed_usd: number;
  markup_factor: number;
  estimate_remaining_raw_usd: number;
  estimate_total_raw_usd: number;
  estimate_total_billed_usd: number;
  /** Aggregated per-stage raw-cost buckets. Keys are dynamic — current
   * backend emits { mineru_gpu, llm } but more may be added. Iterate keys
   * in the UI; never hard-code field access. */
  by_stage: Record<string, number>;
  by_segment: CostSegmentBreakdown[];
  llm_tokens: {
    input: number;
    cache_read: number;
    cache_write: number;
    output: number;
  };
  formula_url?: string;
}

export type ProofKind = "theorem" | "lemma" | "proposition" | "proof" | "claim";

export type IssueType =
  | "arithmetic"
  | "logic"
  | "unstated_assumption"
  | "wrong_constant"
  | "quantifier_scope"
  | "citation_required"
  | "definition_mismatch"
  | "missing_step"
  | "other";

export type Severity = "high" | "medium" | "low";
export type Decision = "agree" | "dismiss";
export type LocalizeStatus =
  | "pending"
  | "done"
  | "approximate"
  | "not_located"
  | "user_placed"
  | "quote_unverified"
  // "dropped" kept for tolerance of legacy papers persisted under the old localizer
  | "dropped";

export type BboxSource =
  | "page_map_single"
  | "page_map_union"
  | "vision_verified"
  | "user_placed"
  | "missing";

export type AnchorConfidence =
  | "exact_in_block"
  | "exact_near_block"
  | "fuzzy_in_block"
  | "fuzzy_far"
  | "none";
export type ExchangeRole = "user" | "assistant";

export interface Bbox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProofBlock {
  id: string;
  paper_id: string;
  kind: ProofKind;
  statement: string;
  body: string;
  page_hint: number;
  section: string;
  char_offset: number;
}

export interface Exchange {
  id: string;
  finding_id: string;
  role: ExchangeRole;
  text: string;
  created_at: string;
}

export interface Finding {
  id: string;
  paper_id: string;
  proof_block_id: string;
  issue_type: IssueType;
  description: string;
  evidence_quote: string;
  severity: Severity;
  confidence: number;
  bbox?: Bbox;
  bbox_page?: number;
  page?: number;
  visually_verified: boolean;
  localize_status: LocalizeStatus;
  bbox_source?: BboxSource;
  location_confidence?: number;
  anchor_confidence?: AnchorConfidence;
  parse_version?: string;
  decision?: Decision;
  decision_note?: string;
  exchanges: Exchange[];
  /** v2: which review dimension this finding contributes to. Defaults to
   * "proof" for findings created by the legacy pipeline (backend migration
   * backfills existing data). */
  dimension?: Dimension;
}

export interface Paper {
  id: string;
  title: string;
  filename: string;
  status: PaperStatus;
  created_at: string;
  markdown?: string;
  page_map?: Record<string, number>;
  findings: Finding[];
  run_state?: RunState;
  segments?: Segment[];
  total_pages?: number;
  outline_version?: string;
  budget_cap_usd?: number;
  updated_at?: string;
  // v2 fields — optional during migration; backend backfills existing papers.
  venue_type?: VenueType;
  venue_name?: string;
  /** v3: nullable. Inbox is retired; null means Unfiled. */
  folder?: string | null;
  review_style?: ReviewStyleSnapshot;
  triage?: TriageReport;
  stage?: ReviewStage;
  dimension_scores?: DimensionScore[];
  /** Frozen aggregate score after finalize-review. Undefined until then. */
  final_score?: number;
  /** v3: per-paper flag (promising/rejected). Server-canonical. */
  flag?: PaperFlag | null;
}

export interface PaperSummary {
  id: string;
  title: string;
  filename: string;
  status: PaperStatus;
  created_at: string;
  finding_count: number;
  decided_count: number;
  // v2 fields — optional so the library can render legacy summaries.
  venue_type?: VenueType;
  venue_name?: string;
  /** v3: nullable. */
  folder?: string | null;
  stage?: ReviewStage;
  triage_verdict?: TriageVerdict;     // surfaced for badge rendering on the list
  final_score?: number;               // shown on the card if frozen
  /** v3: per-paper flag. */
  flag?: PaperFlag | null;
}

export interface PaperStatusResponse {
  status: PaperStatus;
  step: PipelineStep;
  step_index: number;
  total_steps: number;
  error?: {
    code: string;
    message: string;
    retriable: boolean;
  };
  finding_count: number;
  localize_pending: number;
}

export interface ApiError {
  error: { code: string; message: string; detail?: unknown };
}

export interface DraftReview {
  draft_id: string;
  markdown: string;
  created_at?: string;
  updated_at?: string;
}

export interface DraftReviewSummary {
  draft_id: string;
  created_at: string;
  updated_at: string;
  word_count: number;
  preview: string;
}

export type ReviewStyle =
  | "rigorous_skeptical"
  | "constructive_mentoring"
  | "terse_expert";

export type ReviewTone = "formal" | "neutral" | "casual";

export type ReviewLength = "short" | "standard" | "thorough";

export type ReviewSection =
  | "summary"
  | "strengths"
  | "weaknesses"
  | "detailed"
  | "questions"
  | "minor";

export interface ReviewConfig {
  field?: string;
  style?: ReviewStyle;
  tone?: ReviewTone;
  length?: ReviewLength;
  sections?: ReviewSection[];
}

// ---------------------------------------------------------------------------
// v2: Two-stage review (Triage → Deep Dive) + multi-dimensional scoring.
// Mirrors backend/app/models.py — keep in sync.
// ---------------------------------------------------------------------------

export type VenueType =
  | "journal"
  | "conference"
  | "grant"   // NSF / NIH / etc.
  | "thesis"
  | "other";

/** The six review dimensions surfaced as findings tags + radar axes. */
export type Dimension =
  | "proof"
  | "literature"
  | "clarity"
  | "numerical"
  | "relevance"
  | "novelty";

/** Triage outcome — drives the H/M/L verdict on whether to deep-dive. */
export type TriageVerdict = "high" | "medium" | "low";

export interface TriageReport {
  scope: string;          // 1-2 sentences
  novelty: string;        // 2-3 sentences vs prior work
  venue_match: string;    // 1-2 sentences re fit to declared venue
  summary: string;        // 3-4 sentences review-summary
  verdict: TriageVerdict;
  confidence: number;     // 0..1
  cost_usd: number;
  generated_at: string;
}

/** Per-dimension score with its rationale + the findings that drove it. */
export interface DimensionScore {
  dimension: Dimension;
  score: number;          // 0..10 base score from deep-dive pass
  rationale: string;      // 1-2 sentences
  finding_ids: string[];  // findings tagged with this dimension
}

/** Lifecycle stage of a paper through the v2 pipeline. */
export type ReviewStage =
  | "uploaded"   // pre-triage (just uploaded)
  | "triaging"   // triage in flight
  | "triaged"    // triage done, awaiting user decision
  | "diving"     // deep dive in flight
  | "dived";     // deep dive complete

/** Snapshot of scores returned by GET /scores. Frozen=true after finalize. */
export interface ScoresResponse {
  dimensions: DimensionScore[];
  aggregate: number;      // 0..10 mean across dimensions
  frozen: boolean;        // true once final review has been generated
}

export interface FinalizeReviewResponse {
  aggregate: number;
  draft_id: string;
}

// ---------------------------------------------------------------------------
// v3: Flags, Folders (object-shaped), Onboarding, Batch
// ---------------------------------------------------------------------------

export type PaperFlag = "promising" | "rejected";

/** v3: /v1/folders returns Folder records, not bare strings. */
export interface Folder {
  name: string;
  venue_type?: VenueType | null;
  created_at: string;
  is_default: boolean;
}

export interface OnboardingProfile {
  name: string;
  role: string;
  field: string;
  /** v3: free-form research-interest tags, e.g., ["high-dim statistics",
   * "Bayesian inference"]. Drives prompt calibration once the backend
   * persists it (currently optional / ignored on roundtrip). */
  research_interests?: string[];
  default_venues: string[];
  default_review_style: ReviewStyleSnapshot;
  completed_at: string;
}

/** v3 batch endpoint actions. Payload shape varies by action — see api.ts
 * comments for the per-action expectations. */
export type BatchAction = "dive_deep" | "flag" | "set_folder" | "delete";

export interface BatchResultItem {
  paper_id: string;
  ok: boolean;
  skipped: boolean;
  error?: string | null;
}

export interface BatchResponse {
  results: BatchResultItem[];
  summary: { ok: number; failed: number };
}

/** Style snapshot persisted on a paper at upload time (mirrors ReviewConfig). */
export type ReviewStyleSnapshot = ReviewConfig;

/** Payload accepted by POST /papers (multipart). All optional except `file`. */
export interface UploadPaperPayload {
  file: File;
  venue_type?: VenueType;
  venue_name?: string;
  folder?: string;
  review_style?: ReviewStyleSnapshot;
}

// ---------------------------------------------------------------------------
// LLM providers — drives the grouped picker in the settings panel.
// Mirrors backend/app/routes/providers.py.
// ---------------------------------------------------------------------------

export interface ProviderModel {
  id: string;
  label: string;
  note?: string | null;
}

export interface ProviderGroup {
  id: "anthropic" | "openai" | "china" | "ollama" | "local" | string;
  label: string;
  kind: "cloud" | "local";
  configured: boolean;
  privacy: string;
  hint?: string | null;
  models: ProviderModel[];
}

