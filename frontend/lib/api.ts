// Typed fetch layer for the Loupe backend.
// Rewrites /api/* → http://localhost:8010/* via next.config.mjs.
// In mock mode, MSW intercepts these same URLs in the browser.

import type {
  CostReport,
  Decision,
  DraftReview,
  Finding,
  Paper,
  PaperStatusResponse,
  PaperSummary,
} from "./types";

const BASE = "/api/v1";

/**
 * Normalize backend JSON so every entity exposes `.id` alongside its
 * native `{entity}_id` field. Backend returns `paper_id`, `finding_id`,
 * `segment_id`, `proof_block_id`, `exchange_id`, `draft_id`; the frontend
 * types use `.id`. Rather than rewrite every call site, we alias here.
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

  uploadPaper: async (file: File): Promise<Paper> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${BASE}/papers`, { method: "POST", body: form });
    if (!res.ok) {
      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {}
      const msg =
        (payload as { error?: { message?: string } })?.error?.message ??
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

  generateReview: (paperId: string) =>
    request<DraftReview>(`/papers/${paperId}/review/generate`, { method: "POST" }),

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

  skipSegment: (paperId: string, segmentId: string) =>
    request<Paper>(`/papers/${paperId}/segments/${segmentId}/skip`, {
      method: "POST",
    }),

  getCost: (paperId: string) =>
    request<CostReport>(`/papers/${paperId}/cost`),
};
