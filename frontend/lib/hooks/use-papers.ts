"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  Bbox,
  Decision,
  Exchange,
  Paper,
  UploadPaperPayload,
} from "@/lib/types";

export const paperKeys = {
  all: ["papers"] as const,
  list: () => [...paperKeys.all, "list"] as const,
  detail: (id: string) => [...paperKeys.all, "detail", id] as const,
  status: (id: string) => [...paperKeys.all, "status", id] as const,
  cost: (id: string) => [...paperKeys.all, "cost", id] as const,
};

export function usePaperList() {
  return useQuery({
    queryKey: paperKeys.list(),
    queryFn: api.listPapers,
    staleTime: 5_000,
  });
}

export function usePaper(id: string) {
  return useQuery({
    queryKey: paperKeys.detail(id),
    queryFn: () => api.getPaper(id),
    enabled: !!id,
  });
}

export function usePaperStatus(id: string, enabled: boolean) {
  return useQuery({
    queryKey: paperKeys.status(id),
    queryFn: () => api.getStatus(id),
    enabled,
    refetchInterval: 1500,
    refetchIntervalInBackground: true,
  });
}

export function useUploadPaper() {
  const qc = useQueryClient();
  return useMutation({
    // v2: accepts the full payload (venue/folder/style); a bare File still
    // works for legacy callers via api.uploadPaper's overload.
    mutationFn: (input: File | UploadPaperPayload) => api.uploadPaper(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: paperKeys.list() }),
  });
}

export function useDeletePaper() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deletePaper(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: paperKeys.list() }),
  });
}

export function useDecideFinding(paperId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      findingId,
      decision,
      note,
    }: {
      findingId: string;
      decision: Decision;
      note?: string;
    }) => api.decideFinding(paperId, findingId, decision, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: paperKeys.detail(paperId) });
      // /scores response is decision-derived on the backend — refresh it so
      // the radar + aggregate update without waiting for the staleTime.
      qc.invalidateQueries({ queryKey: ["scores", paperId] });
    },
  });
}

export function usePaperCost(paperId: string, enabled: boolean) {
  return useQuery({
    queryKey: paperKeys.cost(paperId),
    queryFn: () => api.getCost(paperId),
    enabled,
    refetchInterval: 2_000,
  });
}

export function useStopPaper() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.stopPaper(id),
    onSuccess: (paper) =>
      qc.setQueryData(paperKeys.detail(paper.id), paper),
  });
}

export function useResumePaper() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.resumePaper(id),
    onSuccess: (paper) =>
      qc.setQueryData(paperKeys.detail(paper.id), paper),
  });
}

export function useReanalyzePaper() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.reanalyzePaper(id),
    onSuccess: (paper) =>
      qc.setQueryData(paperKeys.detail(paper.id), paper),
  });
}

export function useSkipSegment(paperId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (segmentId: string) => api.skipSegment(paperId, segmentId),
    onSuccess: (paper) =>
      qc.setQueryData(paperKeys.detail(paperId), paper),
  });
}

export function useInvestigateFinding(paperId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      findingId,
      message,
    }: {
      findingId: string;
      message: string;
    }) => api.investigateFinding(paperId, findingId, message),
    // Optimistic update: the moment the user clicks Send, append their
    // message + a "thinking…" placeholder so the thread feels instant.
    // React Query caches the new paper snapshot, card re-renders with the
    // preview, and when the real response lands onSettled swaps it in.
    onMutate: async ({ findingId, message }) => {
      await qc.cancelQueries({ queryKey: paperKeys.detail(paperId) });
      const prev = qc.getQueryData<Paper>(paperKeys.detail(paperId));
      if (prev) {
        const now = new Date().toISOString();
        const userMsg: Exchange = {
          id: `_opt_user_${Date.now()}`,
          finding_id: findingId,
          role: "user",
          text: message,
          created_at: now,
        };
        const placeholder: Exchange = {
          id: `_opt_pending_${Date.now()}`,
          finding_id: findingId,
          role: "assistant",
          text: "…thinking",
          created_at: now,
        };
        qc.setQueryData<Paper>(paperKeys.detail(paperId), {
          ...prev,
          findings: prev.findings.map((f) =>
            f.id === findingId
              ? { ...f, exchanges: [...f.exchanges, userMsg, placeholder] }
              : f
          ),
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(paperKeys.detail(paperId), ctx.prev);
    },
    onSettled: () =>
      qc.invalidateQueries({ queryKey: paperKeys.detail(paperId) }),
  });
}

export function usePlaceFinding(paperId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      findingId,
      page,
      bbox,
    }: {
      findingId: string;
      page: number;
      bbox: Bbox;
    }) => api.placeFinding(paperId, findingId, page, bbox),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: paperKeys.detail(paperId) }),
  });
}
