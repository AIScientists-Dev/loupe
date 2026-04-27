// Typed fetch layer for the Loupe backend.
// Rewrites /api/* → http://localhost:8010/* via next.config.mjs.
// In mock mode, MSW intercepts these same URLs in the browser.

import type {
  BatchAction,
  BatchResponse,
  Bbox,
  CostReport,
  Decision,
  DraftReview,
  DraftReviewSummary,
  FinalizeReviewResponse,
  Finding,
  Folder,
  OnboardingProfile,
  Paper,
  PaperFlag,
  PaperStatusResponse,
  PaperSummary,
  ProviderGroup,
  ReviewConfig,
  ScoresResponse,
  TriageReport,
  UploadPaperPayload,
  VenueType,
} from "./types";

const BASE = "/api/v1";

/**
 * Normalize backend JSON so every entity exposes `.id` alongside its
 * native `{entity}_id` field. Backend returns `paper_id`, `finding_id`,
 * `segment_id`, `proof_block_id`, `exchange_id`, `draft_id`; the frontend
 * types use `.id`. Rather than rewrite every call site, we alias here.
 *
 * Also aliases Exchange.content → Exchange.text (backend stores messages
 * under `content` but frontend types + rendering use `text`).
 */
function normalizeIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeIds);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src)) out[k] = normalizeIds(src[k]);
    if (!("id" in out)) {
      for (const k of Object.keys(src)) {
        if (k.endsWith("_id") && typeof src[k] === "string") {
          out.id = src[k];
          break;
        }
      }
    }
    if (
      !("text" in out) &&
      typeof out.content === "string" &&
      typeof out.role === "string"
    ) {
      out.text = out.content;
    }
    return out;
  }
  return value;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      // ignore
    }
    const msg =
      (payload as { error?: { message?: string } })?.error?.message ??
      `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as T;
  const json = await res.json();
  return normalizeIds(json) as T;
}

export const api = {
  listPapers: () => request<PaperSummary[]>("/papers"),

  getPaper: (id: string) => request<Paper>(`/papers/${id}`),

  getStatus: (id: string) =>
    request<PaperStatusResponse>(`/papers/${id}/status`),

  deletePaper: (id: string) =>
    request<void>(`/papers/${id}`, { method: "DELETE" }),

  /**
   * v2 upload: also accepts venue_type, venue_name, folder, and a
   * review_style snapshot. Backwards-compatible — calling with just the file
   * arg still works (back-compat helper at the bottom of the call site).
   *
   * Backend kicks **triage** automatically on success. The returned Paper
   * has stage="triaging"; the triage report shows up via SSE + polling.
   */
  uploadPaper: async (input: File | UploadPaperPayload): Promise<Paper> => {
    const payload: UploadPaperPayload =
      input instanceof File ? { file: input } : input;
    const form = new FormData();
    form.append("file", payload.file);
    if (payload.venue_type) form.append("venue_type", payload.venue_type);
    if (payload.venue_name) form.append("venue_name", payload.venue_name);
    if (payload.folder) form.append("folder", payload.folder);
    if (payload.review_style)
      form.append("review_style", JSON.stringify(payload.review_style));
    const res = await fetch(`${BASE}/papers`, { method: "POST", body: form });
    if (!res.ok) {
      let errPayload: unknown = null;
      try {
        errPayload = await res.json();
      } catch {}
      const msg =
        (errPayload as { error?: { message?: string } })?.error?.message ??
        "Upload failed";
      throw new Error(msg);
    }
    const json = await res.json();
    return normalizeIds(json) as Paper;
  },

  decideFinding: (paperId: string, findingId: string, decision: Decision, note?: string) =>
    request<Finding>(
      `/papers/${paperId}/findings/${findingId}/decide`,
      {
        method: "POST",
        body: JSON.stringify({ decision, note }),
      }
    ),

  investigateFinding: (paperId: string, findingId: string, message: string) =>
    request<Finding>(`/papers/${paperId}/findings/${findingId}/investigate`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),

  localizeFinding: (paperId: string, findingId: string) =>
    request<Finding>(`/papers/${paperId}/findings/${findingId}/localize`, {
      method: "POST",
    }),

  placeFinding: (paperId: string, findingId: string, page: number, bbox: Bbox) =>
    request<Finding>(`/papers/${paperId}/findings/${findingId}/place`, {
      method: "POST",
      body: JSON.stringify({ page, bbox }),
    }),

  generateReview: (paperId: string, config?: ReviewConfig) =>
    request<DraftReview>(`/papers/${paperId}/review/generate`, {
      method: "POST",
      body: JSON.stringify(config ?? {}),
    }),

  listReviews: (paperId: string) =>
    request<DraftReviewSummary[]>(`/papers/${paperId}/reviews`),

  getReview: (paperId: string, draftId: string) =>
    request<DraftReview>(`/papers/${paperId}/review/${draftId}`),

  updateReview: (paperId: string, draftId: string, markdown: string) =>
    request<DraftReview>(`/papers/${paperId}/review/${draftId}`, {
      method: "PATCH",
      body: JSON.stringify({ markdown }),
    }),

  pdfUrl: (paperId: string) => `${BASE}/papers/${paperId}/pdf`,

  pdfAnnotatedUrl: (paperId: string) =>
    `${BASE}/papers/${paperId}/pdf-annotated`,

  pageThumbUrl: (paperId: string, page: number) =>
    `${BASE}/papers/${paperId}/pages/${page}/thumb.png`,

  exportReview: (paperId: string, draftId: string, format: "pdf" | "md") =>
    `${BASE}/papers/${paperId}/review/${draftId}/export?format=${format}`,

  stopPaper: (id: string) =>
    request<Paper>(`/papers/${id}/stop`, { method: "POST" }),

  resumePaper: (id: string) =>
    request<Paper>(`/papers/${id}/resume`, { method: "POST" }),

  reanalyzePaper: (id: string) =>
    request<Paper>(`/papers/${id}/reanalyze`, { method: "POST" }),

  skipSegment: (paperId: string, segmentId: string) =>
    request<Paper>(`/papers/${paperId}/segments/${segmentId}/skip`, {
      method: "POST",
    }),

  getCost: (paperId: string) =>
    request<CostReport>(`/papers/${paperId}/cost`),

  // -------------------------------------------------------------------------
  // v2: Triage → Deep Dive → Scoring → Finalize
  // -------------------------------------------------------------------------

  /** Triage report — short scope/novelty/match/summary + H/M/L verdict.
   * Returns 404 while triage is still running (poll, or use SSE). */
  getTriage: (paperId: string) =>
    request<TriageReport>(`/papers/${paperId}/triage`),

  /** Kick the deep-dive pipeline (proof + literature + clarity + numerical
   * + relevance + novelty). 202-style endpoint — returns immediately with
   * the updated paper; progress streams via SSE. Idempotent: a second call
   * while a dive is in flight is a no-op. */
  diveDeep: (paperId: string) =>
    request<Paper>(`/papers/${paperId}/dive-deep`, { method: "POST" }),

  /** Current dimension scores. `frozen=true` once finalize-review has been
   * called; subsequent decide/dismiss actions don't change them. */
  getScores: (paperId: string) =>
    request<ScoresResponse>(`/papers/${paperId}/scores`),

  /** Freeze the score and produce a final draft review in one shot.
   * Returns the aggregate (frozen) and the new draft_id. */
  finalizeReview: (paperId: string, config?: ReviewConfig) =>
    request<FinalizeReviewResponse>(`/papers/${paperId}/finalize-review`, {
      method: "POST",
      body: JSON.stringify(config ?? {}),
    }),

  /** List configured LLM providers (cloud + local). Drives the grouped
   * picker in settings — only providers whose API keys / endpoints are
   * actually configured come back as `configured: true`. */
  listProviders: () => request<ProviderGroup[]>(`/providers`),

  /** List folders. v3 backend returns Folder records (name + venue_type + is_default). */
  listFolders: () => request<Folder[]>(`/folders`),

  /** Create a folder. 409 on duplicate name. */
  createFolder: (name: string, venue_type?: VenueType) =>
    request<Folder>(`/folders`, {
      method: "POST",
      body: JSON.stringify({ name, venue_type: venue_type ?? null }),
    }),

  /** Rename a folder. Cascades onto every paper.folder == oldName.
   * 404 on missing, 409 on rename collision. */
  renameFolder: (oldName: string, nextName: string) =>
    request<Folder>(`/folders/${encodeURIComponent(oldName)}`, {
      method: "PATCH",
      body: JSON.stringify({ name: nextName }),
    }),

  /** Reparent a folder under a venue_type group, or pass null to make it a
   * top-level orphan again. Drives the hierarchical sidebar render. */
  setFolderVenueType: (name: string, venue_type: VenueType | null) =>
    request<Folder>(`/folders/${encodeURIComponent(name)}`, {
      method: "PATCH",
      body: JSON.stringify({ venue_type }),
    }),

  /** Delete a folder. Papers in it become Unfiled (paper.folder = null).
   * Refuses on is_default folders (returns 409). */
  deleteFolder: (name: string) =>
    request<void>(`/folders/${encodeURIComponent(name)}`, { method: "DELETE" }),

  /** Move a paper into a different folder (or null to unfile). */
  setFolder: (paperId: string, folder: string | null) =>
    request<Paper>(`/papers/${paperId}/folder`, {
      method: "PATCH",
      body: JSON.stringify({ folder }),
    }),

  /** Set paper.flag (promising/rejected/null). Idempotent. */
  setFlag: (paperId: string, flag: PaperFlag | null) =>
    request<Paper>(`/papers/${paperId}/flag`, {
      method: "POST",
      body: JSON.stringify({ flag }),
    }),

  // --- Onboarding ---------------------------------------------------------

  /** Returns the persisted onboarding profile, or null if the user hasn't
   * completed onboarding yet. The backend returns 404 in that case; we
   * normalize to null so callers don't need to catch. */
  getOnboarding: async (): Promise<OnboardingProfile | null> => {
    const res = await fetch(`${BASE}/onboarding`);
    if (res.status === 404) return null;
    if (!res.ok) {
      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {}
      const msg =
        (payload as { error?: { message?: string } })?.error?.message ??
        `Onboarding fetch failed: ${res.status}`;
      throw new Error(msg);
    }
    return (await res.json()) as OnboardingProfile;
  },

  /** Submit onboarding. First call seeds folders from default_venues; later
   * calls update the profile but don't re-seed. */
  submitOnboarding: (input: Omit<OnboardingProfile, "completed_at">) =>
    request<OnboardingProfile>(`/onboarding`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // --- Batch --------------------------------------------------------------

  /** Run a single action across many papers. Sequential on the backend with
   * per-paper result reporting. See V3_BACKEND_SPEC §2 for payload shapes
   * per action. */
  batchPapers: (input: {
    ids: string[];
    action: BatchAction;
    payload?: Record<string, unknown>;
  }) =>
    request<BatchResponse>(`/papers/batch`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
