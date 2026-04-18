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

export interface CostBreakdown {
  by_stage: {
    outline: number;
    mineru_gpu: number;
    extract: number;
    verify: number;
    localize: number;
  };
  llm_tokens: {
    input: number;
    cache_read: number;
    cache_write: number;
    output: number;
  };
}

export interface CostReport {
  running_raw_usd: number;
  running_billed_usd: number;
  markup_factor: number;
  estimate_remaining_raw_usd: number;
  estimate_total_raw_usd: number;
  breakdown: CostBreakdown;
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
export type LocalizeStatus = "pending" | "done" | "dropped";
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
  visually_verified: boolean;
  localize_status: LocalizeStatus;
  decision?: Decision;
  decision_note?: string;
  exchanges: Exchange[];
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
}

export interface PaperSummary {
  id: string;
  title: string;
  filename: string;
  status: PaperStatus;
  created_at: string;
  finding_count: number;
  decided_count: number;
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
}
