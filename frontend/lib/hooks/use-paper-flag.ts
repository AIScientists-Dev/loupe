"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Paper, PaperFlag, PaperSummary } from "@/lib/types";
import { paperKeys } from "./use-papers";

export type { PaperFlag } from "@/lib/types";

/**
 * v3: flags are server-canonical (paper.flag on the GET /papers and GET
 * /papers/{id} responses). This module reads them via React Query (no
 * extra fetches) and exposes a setter that POSTs + optimistically updates
 * the list + detail caches.
 */

function flagOf(p: { flag?: PaperFlag | null } | null | undefined): PaperFlag | null {
  return p?.flag ?? null;
}

/** Hook returning a stable setter that calls the server + patches caches. */
export function usePaperFlagSetter() {
  const qc = useQueryClient();
  return React.useCallback(
    async (paperId: string, flag: PaperFlag | null): Promise<void> => {
      const prevDetail = qc.getQueryData<Paper>(paperKeys.detail(paperId));
      const prevList = qc.getQueryData<PaperSummary[]>(paperKeys.list());

      // Optimistic patch.
      if (prevDetail) {
        qc.setQueryData<Paper>(paperKeys.detail(paperId), { ...prevDetail, flag });
      }
      if (prevList) {
        qc.setQueryData<PaperSummary[]>(
          paperKeys.list(),
          prevList.map((p) => (p.id === paperId ? { ...p, flag } : p)),
        );
      }

      try {
        const updated = await api.setFlag(paperId, flag);
        qc.setQueryData<Paper>(paperKeys.detail(paperId), updated);
        qc.invalidateQueries({ queryKey: paperKeys.list() });
      } catch (e) {
        if (prevDetail) qc.setQueryData(paperKeys.detail(paperId), prevDetail);
        if (prevList) qc.setQueryData(paperKeys.list(), prevList);
        throw e;
      }
    },
    [qc],
  );
}

/**
 * Read the current flag for a paper. Subscribes via the existing list
 * query (no extra fetch) and falls back to the detail cache for fresh
 * post-mutation values.
 *
 * IMPORTANT: this hook is render-stable — it does NOT subscribe to the
 * raw cache event stream (which causes re-render loops). It re-renders
 * only when its underlying list/detail query data changes, exactly like
 * any other useQuery consumer.
 */
export function usePaperFlag(paperId: string): PaperFlag | null {
  const list = useQuery({
    queryKey: paperKeys.list(),
    queryFn: api.listPapers,
    staleTime: 5_000,
    enabled: false,           // we don't trigger; we just subscribe to whatever's already there
    notifyOnChangeProps: ["data"],
  });
  // The detail cache may be more recent than the list (e.g., right after a
  // setFlag mutation). Prefer it when available — if it doesn't exist, fall
  // back to the list snapshot. We use `useQuery({ enabled: false })` purely
  // for subscription; we don't initiate a fetch.
  const detail = useQuery({
    queryKey: paperKeys.detail(paperId),
    queryFn: () => api.getPaper(paperId),
    enabled: false,
    notifyOnChangeProps: ["data"],
  });

  if (detail.data) return flagOf(detail.data);
  if (list.data) {
    const summary = list.data.find((p) => p.id === paperId);
    return flagOf(summary);
  }
  return null;
}

/**
 * Backward-compatible aggregate hook used by the sidebar status-folder
 * counts and the batch action bar. Mirrors the prior store's shape:
 * `{ flags: Record<id, PaperFlag>, set }` derived from the paper list.
 */
export interface PaperFlagsHookReturn {
  flags: Record<string, PaperFlag>;
  set: (paperId: string, flag: PaperFlag | null) => Promise<void>;
}

const EMPTY_FLAGS: Record<string, PaperFlag> = {};

export function usePaperFlags<T = PaperFlagsHookReturn>(
  selector?: (s: PaperFlagsHookReturn) => T,
): T {
  const list = useQuery({
    queryKey: paperKeys.list(),
    queryFn: api.listPapers,
    staleTime: 5_000,
    notifyOnChangeProps: ["data"],
  });
  const set = usePaperFlagSetter();

  // Memoize the derived flag map by `list.data` reference so the returned
  // object is stable when nothing has changed.
  const flags = React.useMemo<Record<string, PaperFlag>>(() => {
    if (!list.data) return EMPTY_FLAGS;
    const out: Record<string, PaperFlag> = {};
    for (const p of list.data) {
      if (p.flag) out[p.id] = p.flag;
    }
    return out;
  }, [list.data]);

  // The returned `value` object reference must also be stable when its
  // members are stable, otherwise selector consumers re-render every tick.
  const value = React.useMemo<PaperFlagsHookReturn>(
    () => ({ flags, set }),
    [flags, set],
  );
  if (selector) return selector(value);
  return value as unknown as T;
}
