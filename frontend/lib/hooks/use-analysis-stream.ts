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

  React.useEffect(() => {
    if (!enabled || !paperId) return;
    if (typeof window === "undefined" || !("EventSource" in window)) return;

    let es: EventSource | null = null;
    let cancelled = false;

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
    };

    const onStepCompleted = (e: MessageEvent) => {
      const d = safeParse<{ step: PipelineStep }>(e.data);
      if (!d) return;
      // Leave the status unchanged; step.started for the next step follows.
    };

    const onStepFailed = (e: MessageEvent) => {
      const d = safeParse<{
        step: PipelineStep;
        error: { code: string; message: string; retriable: boolean };
      }>(e.data);
      if (!d) return;
      patchStatus({ status: "failed", step: d.step, error: d.error });
    };

    const onFindingCreated = () => {
      // Simplest: invalidate the detail query so it refetches with the new list.
      qc.invalidateQueries({ queryKey: paperKeys.detail(paperId) });
      // Also bump finding_count on status cache so the progress pill updates.
      qc.setQueryData<PaperStatusResponse>(paperKeys.status(paperId), (old) =>
        old ? { ...old, finding_count: old.finding_count + 1 } : old
      );
    };

    const onLocalizeCompleted = (e: MessageEvent) => {
      const d = safeParse<Partial<Finding> & { finding_id: string }>(e.data);
      if (!d) return;
      qc.invalidateQueries({ queryKey: paperKeys.detail(paperId) });
    };

    const onPipelineDone = () => {
      patchStatus({ status: "ready", step: "ready", step_index: 3 });
      qc.invalidateQueries({ queryKey: paperKeys.detail(paperId) });
      qc.invalidateQueries({ queryKey: paperKeys.list() });
      if (es) es.close();
    };

    es.addEventListener("step.started", onStepStarted);
    es.addEventListener("step.completed", onStepCompleted);
    es.addEventListener("step.failed", onStepFailed);
    es.addEventListener("finding.created", onFindingCreated);
    es.addEventListener("localize.completed", onLocalizeCompleted);
    es.addEventListener("pipeline.done", onPipelineDone);

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
