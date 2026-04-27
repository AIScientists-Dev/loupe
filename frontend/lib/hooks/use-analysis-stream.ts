"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";

import type {
  CostReport,
  Finding,
  Paper,
  PaperStatusResponse,
  PipelineStep,
  RunState,
  Segment,
  SegmentStatus,
} from "@/lib/types";
import { paperKeys } from "./use-papers";
import { useActivityLog } from "./use-activity-log";

/**
 * Subscribe to the backend SSE analysis stream. Updates the React Query
 * cache (status + detail) live as events arrive.
 *
 * Events emitted (per backend contract):
 *   step.started       {step, step_index}
 *   step.completed     {step, summary?}
 *   step.failed        {step, error: {code, message, retriable}}
 *   finding.created    {finding}
 *   localize.completed {finding_id, localize_status, bbox?}
 *   pipeline.done      {status: "ready"}
 *
 * If the EventSource errors or the browser can't subscribe, the hook
 * closes quietly — `usePaperStatus` polling is the fallback.
 */
export function useAnalysisStream(paperId: string, enabled: boolean) {
  const qc = useQueryClient();
  const pushEvent = useActivityLog((s) => s.push);

  React.useEffect(() => {
    if (!enabled || !paperId) return;
    if (typeof window === "undefined" || !("EventSource" in window)) return;

    let es: EventSource | null = null;
    let cancelled = false;
    const log = (
      kind: Parameters<typeof pushEvent>[1],
      message: string,
    ) => pushEvent(paperId, kind, message);

    try {
      es = new EventSource(`/api/v1/papers/${paperId}/events`);
    } catch {
      return;
    }

    const patchStatus = (patch: Partial<PaperStatusResponse>) => {
      qc.setQueryData<PaperStatusResponse>(paperKeys.status(paperId), (old) => ({
        status: old?.status ?? "analyzing",
        step: old?.step ?? "parse",
        step_index: old?.step_index ?? 0,
        total_steps: old?.total_steps ?? 3,
        finding_count: old?.finding_count ?? 0,
        localize_pending: old?.localize_pending ?? 0,
        ...patch,
      }));
    };

    const onStepStarted = (e: MessageEvent) => {
      const d = safeParse<{ step: PipelineStep; step_index: number }>(e.data);
      if (!d) return;
      patchStatus({ step: d.step, step_index: d.step_index, status: "analyzing" });
      log("step", `${humanStep(d.step)} started`);
    };

    const onStepCompleted = (e: MessageEvent) => {
      const d = safeParse<{ step: PipelineStep }>(e.data);
      if (!d) return;
      log("step", `${humanStep(d.step)} done`);
    };

    const onStepFailed = (e: MessageEvent) => {
      const d = safeParse<{
        step: PipelineStep;
        error: { code: string; message: string; retriable: boolean };
      }>(e.data);
      if (!d) return;
      patchStatus({ status: "failed", step: d.step, error: d.error });
      log("step", `${humanStep(d.step)} failed · ${d.error.message}`);
    };

    const onFindingCreated = (e: MessageEvent) => {
      const d = safeParse<{ finding?: Partial<Finding> }>(e.data);
      qc.invalidateQueries({ queryKey: paperKeys.detail(paperId) });
      qc.setQueryData<PaperStatusResponse>(paperKeys.status(paperId), (old) =>
        old ? { ...old, finding_count: old.finding_count + 1 } : old
      );
      const f = d?.finding;
      if (f) {
        const issue = (f.issue_type ?? "issue").toString().replace(/_/g, " ");
        const page = f.page ?? f.bbox_page ?? "?";
        log("finding", `Found: ${issue} · p.${page}`);
      } else {
        log("finding", "New finding surfaced");
      }
    };

    const onLocalizeCompleted = (e: MessageEvent) => {
      const d = safeParse<Partial<Finding> & { finding_id: string }>(e.data);
      if (!d) return;
      qc.invalidateQueries({ queryKey: paperKeys.detail(paperId) });
      log("localize", `Pinpointed a finding on the page`);
    };

    const onPipelineDone = () => {
      patchStatus({ status: "ready", step: "ready", step_index: 3 });
      qc.invalidateQueries({ queryKey: paperKeys.detail(paperId) });
      qc.invalidateQueries({ queryKey: paperKeys.list() });
      log("run", "Scan complete");
      if (es) es.close();
    };

    es.addEventListener("step.started", onStepStarted);
    es.addEventListener("step.completed", onStepCompleted);
    es.addEventListener("step.failed", onStepFailed);
    es.addEventListener("finding.created", onFindingCreated);
    es.addEventListener("localize.completed", onLocalizeCompleted);
    es.addEventListener("pipeline.done", onPipelineDone);

    // Segment-based pipeline additions (M0'+).
    const patchPaper = (mut: (p: Paper) => void) => {
      qc.setQueryData<Paper>(paperKeys.detail(paperId), (old) => {
        if (!old) return old;
        const next: Paper = { ...old, segments: old.segments ? [...old.segments] : [] };
        mut(next);
        return next;
      });
    };

    const onOutlineReady = (e: MessageEvent) => {
      const d = safeParse<{
        segments: Segment[];
        total_pages: number;
        estimated_cost_usd: number;
      }>(e.data);
      if (!d) return;
      patchPaper((p) => {
        p.segments = d.segments;
        p.total_pages = d.total_pages;
        p.run_state = "running";
      });
      const priorityCount = d.segments.filter((s) => (s.priority ?? 0) > 0).length;
      log(
        "outline",
        `Outline ready · ${d.total_pages} pages, ${priorityCount} range${priorityCount === 1 ? "" : "s"} to scan`,
      );
    };

    const setSegStatus = (segmentId: string, status: SegmentStatus) => {
      patchPaper((p) => {
        const idx = p.segments?.findIndex((s) => s.segment_id === segmentId);
        if (p.segments && idx !== undefined && idx >= 0) {
          p.segments[idx] = { ...p.segments[idx], status };
        }
      });
    };

    const onSegmentStarted = (e: MessageEvent) => {
      const d = safeParse<Partial<Segment> & { segment_id: string }>(e.data);
      if (!d) return;
      let segLabel: string | undefined;
      let pageRange = "";
      patchPaper((p) => {
        const idx = p.segments?.findIndex((s) => s.segment_id === d.segment_id);
        if (p.segments && idx !== undefined && idx >= 0) {
          p.segments[idx] = {
            ...p.segments[idx],
            ...d,
            status: "parsing",
            started_at: new Date().toISOString(),
          };
          segLabel = p.segments[idx].label;
          pageRange = `p.${p.segments[idx].page_start}–${p.segments[idx].page_end}`;
        }
      });
      if (segLabel)
        log("segment", `Parsing ${segLabel} · ${pageRange}`);
    };

    const onSegmentExtracted = (e: MessageEvent) => {
      const d = safeParse<{ segment_id: string }>(e.data);
      if (!d) return;
      setSegStatus(d.segment_id, "extracting");
      const paper = qc.getQueryData<Paper>(paperKeys.detail(paperId));
      const seg = paper?.segments?.find((s) => s.segment_id === d.segment_id);
      if (seg)
        log(
          "segment",
          `Checking proofs in ${seg.label} · p.${seg.page_start}–${seg.page_end}`,
        );
    };

    const onSegmentCompleted = (e: MessageEvent) => {
      const d = safeParse<{
        segment_id: string;
        cost_subtotal_usd?: number;
        skipped?: boolean;
      }>(e.data);
      if (!d) return;
      let segLabel: string | undefined;
      let pageRange = "";
      patchPaper((p) => {
        const idx = p.segments?.findIndex((s) => s.segment_id === d.segment_id);
        if (p.segments && idx !== undefined && idx >= 0) {
          p.segments[idx] = {
            ...p.segments[idx],
            status: d.skipped ? "skipped" : "done",
            finished_at: new Date().toISOString(),
            cost_subtotal_usd:
              d.cost_subtotal_usd ?? p.segments[idx].cost_subtotal_usd,
          };
          segLabel = p.segments[idx].label;
          pageRange = `p.${p.segments[idx].page_start}–${p.segments[idx].page_end}`;
        }
      });
      if (segLabel)
        log(
          "segment",
          `${d.skipped ? "Skipped" : "Done"} ${segLabel} · ${pageRange}`,
        );
    };

    const onCostUpdated = (e: MessageEvent) => {
      const d = safeParse<Pick<CostReport, "running_raw_usd" | "running_billed_usd">>(
        e.data
      );
      if (!d) return;
      qc.setQueryData<CostReport>(paperKeys.cost(paperId), (old) => {
        if (!old)
          return {
            running_raw_usd: d.running_raw_usd,
            running_billed_usd: d.running_billed_usd,
            markup_factor: 1.35,
            estimate_remaining_raw_usd: 0,
            estimate_total_raw_usd: d.running_raw_usd,
            estimate_total_billed_usd: d.running_billed_usd,
            by_stage: {},
            by_segment: [],
            llm_tokens: { input: 0, cache_read: 0, cache_write: 0, output: 0 },
          };
        return {
          ...old,
          running_raw_usd: d.running_raw_usd,
          running_billed_usd: d.running_billed_usd,
        };
      });
    };

    const onRunState = (state: RunState) => () => {
      patchPaper((p) => {
        p.run_state = state;
        if (state === "completed") p.status = "ready";
      });
      if (state === "completed")
        qc.invalidateQueries({ queryKey: paperKeys.list() });
      log("run", humanRunState(state));
    };

    es.addEventListener("outline.ready", onOutlineReady);
    es.addEventListener("segment.started", onSegmentStarted);
    es.addEventListener("segment.parsing", onSegmentStarted);
    es.addEventListener("segment.extracted", onSegmentExtracted);
    es.addEventListener("segment.completed", onSegmentCompleted);
    es.addEventListener("cost.updated", onCostUpdated);
    es.addEventListener("run.stopped", onRunState("stopped"));
    es.addEventListener("run.resumed", onRunState("running"));
    es.addEventListener("run.completed", onRunState("completed"));

    const onReanalyzeStarted = (e: MessageEvent) => {
      const d = safeParse<{ proof_block_count?: number }>(e.data);
      const n = d?.proof_block_count ?? 0;
      log(
        "run",
        `Re-analysis started${n ? ` · re-verifying ${n} proof block${n === 1 ? "" : "s"}` : ""}`,
      );
    };
    const onReanalyzeCompleted = (e: MessageEvent) => {
      const d = safeParse<{ new_findings?: number }>(e.data);
      const n = d?.new_findings ?? 0;
      log("run", `Re-analysis done · ${n} new finding${n === 1 ? "" : "s"}`);
    };
    es.addEventListener("run.reanalyze_started", onReanalyzeStarted);
    es.addEventListener("run.reanalyze_completed", onReanalyzeCompleted);

    es.onerror = () => {
      // Don't thrash; polling covers this case.
      if (es && es.readyState === EventSource.CLOSED) return;
    };

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [paperId, enabled, qc]);
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function humanStep(step: PipelineStep): string {
  switch (step) {
    case "parse":
      return "Parsing PDF";
    case "extract_proofs":
      return "Extracting proofs";
    case "verify_proofs":
      return "Verifying proofs";
    case "ready":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return String(step);
  }
}

function humanRunState(state: RunState): string {
  switch (state) {
    case "running":
      return "Run resumed";
    case "stopped":
      return "Run stopped";
    case "paused":
      return "Run paused";
    case "completed":
      return "Run complete";
    default:
      return String(state);
  }
}
