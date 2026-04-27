"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Dimension, DimensionScore, Paper } from "@/lib/types";

/**
 * v3: scoring is server-authoritative. The /scores endpoint applies the
 * §3.3 decision formula and returns the post-overlay score. Frontend uses
 * /scores as the single source of truth — it doesn't re-apply the formula
 * client-side, which used to cause double-counting and stale-base bugs.
 *
 * For instant feedback, useDecideFinding invalidates the /scores query
 * key, so React Query refetches the moment a decision lands.
 */

const DIMENSIONS: Dimension[] = [
  "proof",
  "literature",
  "clarity",
  "numerical",
  "relevance",
  "novelty",
];

export interface DerivedScores {
  /** Base scores from the backend deep-dive pass, keyed by dimension. */
  base: Record<Dimension, number> | null;
  /** Live scores after the user's adjustments. Same shape as base. */
  live: Record<Dimension, number> | null;
  /** Mean of `live` across the six dimensions. 0 when base is null. */
  aggregate: number;
  /** True once finalize-review has been called — UI should stop animating. */
  frozen: boolean;
  /** Per-dimension finding count from whichever source we used (server or
   * persisted snapshot). Drives the "prior" badge in the report card. */
  findingCounts: Record<Dimension, number>;
}

/**
 * Subscribe to GET /scores for the base, then recompute live + aggregate
 * from the in-cache findings whenever they change. No backend round-trip
 * on each decide — purely derived state.
 */
export function useDerivedScores(paper: Paper): DerivedScores {
  // Always pull from the live /scores endpoint. The backend re-derives base
  // on every call (and short-circuits for frozen papers), so this is the
  // most up-to-date snapshot — including post-formula-change papers whose
  // persisted `paper.dimension_scores` was written under the old formula.
  // `paper.dimension_scores` is only used as a transient fallback while the
  // first /scores fetch is in flight.
  const scoresQuery = useQuery({
    queryKey: ["scores", paper.id],
    queryFn: () => api.getScores(paper.id),
    staleTime: 10_000,
  });

  const base = React.useMemo<Record<Dimension, number> | null>(() => {
    // Server (preferred) > persisted snapshot (fallback for the first paint).
    const seed =
      scoresQuery.data?.dimensions ??
      (paper.dimension_scores && paper.dimension_scores.length > 0
        ? paper.dimension_scores
        : undefined);
    if (!seed || seed.length === 0) return null;
    const out: Partial<Record<Dimension, number>> = {};
    for (const d of DIMENSIONS) out[d] = 0;
    for (const s of seed as DimensionScore[]) {
      out[s.dimension] = s.score;
    }
    return out as Record<Dimension, number>;
  }, [paper.dimension_scores, scoresQuery.data]);

  // `final_score` arrives as `null` from the backend (not undefined), so the
  // `!== undefined` check accidentally counted unfinalized papers as frozen.
  // Treat null + undefined as "not frozen"; only a real number freezes.
  const frozen =
    (paper.final_score != null) ||
    scoresQuery.data?.frozen === true;

  // The /scores endpoint already applies the §3.3 decision overlay on the
  // backend (see _adjust_scores), so `base` is already the live, decision-
  // aware score. We expose `live` as an alias for symmetry with older
  // callers; mutations on findings invalidate the /scores cache so the
  // next render picks up the refreshed values automatically.
  const live = base;

  const aggregate = React.useMemo(() => {
    if (!live) return 0;
    const sum = DIMENSIONS.reduce((a, d) => a + (live[d] ?? 0), 0);
    return sum / DIMENSIONS.length;
  }, [live]);

  const findingCounts = React.useMemo<Record<Dimension, number>>(() => {
    const seed =
      scoresQuery.data?.dimensions ??
      (paper.dimension_scores && paper.dimension_scores.length > 0
        ? paper.dimension_scores
        : undefined);
    const out = Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<Dimension, number>;
    if (!seed) return out;
    for (const s of seed as DimensionScore[]) {
      out[s.dimension] = s.finding_ids?.length ?? 0;
    }
    return out;
  }, [paper.dimension_scores, scoresQuery.data]);

  return { base, live, aggregate, frozen, findingCounts };
}
