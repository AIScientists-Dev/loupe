"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Decision } from "@/lib/types";

export const paperKeys = {
  all: ["papers"] as const,
  list: () => [...paperKeys.all, "list"] as const,
  detail: (id: string) => [...paperKeys.all, "detail", id] as const,
  status: (id: string) => [...paperKeys.all, "status", id] as const,
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
    mutationFn: (file: File) => api.uploadPaper(file),
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
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: paperKeys.detail(paperId) }),
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
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: paperKeys.detail(paperId) }),
  });
}
