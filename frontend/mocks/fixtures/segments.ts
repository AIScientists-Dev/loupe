import type { Segment, SegmentClassification } from "@/lib/types";

/**
 * Synthetic 100-page paper outline used when a real paper is uploaded in
 * mock mode. Matches the backend design doc's budget example so the cost
 * drawer shows sensible numbers.
 */
export const MOCK_OUTLINE: Omit<Segment, "segment_id" | "status" | "proof_block_ids" | "finding_ids" | "cost_subtotal_usd">[] = [
  {
    page_start: 1,
    page_end: 3,
    label: "Abstract + Introduction",
    classification: "background",
    priority: 2,
    mineru_eta_seconds: 100,
    mineru_seconds_per_page_estimate: 34,
  },
  {
    page_start: 4,
    page_end: 8,
    label: "Preliminaries",
    classification: "background",
    priority: 3,
    mineru_eta_seconds: 170,
    mineru_seconds_per_page_estimate: 34,
  },
  {
    page_start: 9,
    page_end: 18,
    label: "Main Results",
    classification: "theorem",
    priority: 8,
    mineru_eta_seconds: 340,
    mineru_seconds_per_page_estimate: 34,
  },
  {
    page_start: 19,
    page_end: 33,
    label: "Proofs (§4)",
    classification: "proof",
    priority: 10,
    mineru_eta_seconds: 510,
    mineru_seconds_per_page_estimate: 34,
  },
  {
    page_start: 34,
    page_end: 42,
    label: "Experiments",
    classification: "experiment",
    priority: 4,
    mineru_eta_seconds: 306,
    mineru_seconds_per_page_estimate: 34,
  },
  {
    page_start: 43,
    page_end: 45,
    label: "Related + Conclusion",
    classification: "background",
    priority: 2,
    mineru_eta_seconds: 100,
    mineru_seconds_per_page_estimate: 34,
  },
  {
    page_start: 46,
    page_end: 65,
    label: "Supplementary Proofs",
    classification: "proof",
    priority: 9,
    mineru_eta_seconds: 680,
    mineru_seconds_per_page_estimate: 34,
  },
  {
    page_start: 66,
    page_end: 100,
    label: "Supplementary Figures",
    classification: "figures",
    priority: 0,
    mineru_eta_seconds: 0,
    mineru_seconds_per_page_estimate: 34,
  },
];

/**
 * Short 5-page fixture for the hand-crafted planted-bug paper. When that
 * paper is opened, the segment outline maps 1:1 to the 5 pages, keeping
 * the playhead animation understandable.
 */
export const PLANTED_OUTLINE: Omit<Segment, "segment_id" | "status" | "proof_block_ids" | "finding_ids" | "cost_subtotal_usd">[] = [
  {
    page_start: 1,
    page_end: 1,
    label: "Abstract + Intro",
    classification: "background",
    priority: 3,
    mineru_eta_seconds: 15,
    mineru_seconds_per_page_estimate: 15,
  },
  {
    page_start: 2,
    page_end: 2,
    label: "Lemma 1",
    classification: "proof",
    priority: 10,
    mineru_eta_seconds: 15,
    mineru_seconds_per_page_estimate: 15,
  },
  {
    page_start: 3,
    page_end: 3,
    label: "Theorem 1 + Proof",
    classification: "proof",
    priority: 10,
    mineru_eta_seconds: 15,
    mineru_seconds_per_page_estimate: 15,
  },
  {
    page_start: 4,
    page_end: 4,
    label: "Lemma 2 (concentration)",
    classification: "proof",
    priority: 10,
    mineru_eta_seconds: 15,
    mineru_seconds_per_page_estimate: 15,
  },
  {
    page_start: 5,
    page_end: 5,
    label: "Corollary 1",
    classification: "proof",
    priority: 10,
    mineru_eta_seconds: 15,
    mineru_seconds_per_page_estimate: 15,
  },
];

export function buildSegments(
  outline: typeof MOCK_OUTLINE,
  idPrefix: string
): Segment[] {
  return outline.map((o, i) => ({
    ...o,
    segment_id: `${idPrefix}_seg_${i}`,
    status: o.classification === "figures" && o.priority === 0 ? "skipped" : "pending",
    proof_block_ids: [],
    finding_ids: [],
    cost_subtotal_usd: 0,
  }));
}
