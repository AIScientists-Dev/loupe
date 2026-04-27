"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { Dimension, Paper } from "@/lib/types";
import {
  DIMENSIONS_IN_ORDER,
  DIMENSION_LABELS,
  DimensionRadar,
} from "./dimension-radar";
import { useDerivedScores } from "@/lib/hooks/use-score";

/**
 * Right-rail dimension surface: radar + per-axis score chips. Sits above the
 * findings list. `live` scores reflect the user's decisions so far; `base`
 * is the original deep-dive output. When the score is frozen (final review
 * generated), we show "frozen" as a small caption and stop animating.
 */
export function DimensionPanel({
  paper,
  className,
}: {
  paper: Paper;
  className?: string;
}) {
  const { base, live, aggregate, frozen } = useDerivedScores(paper);
  if (!base) return null;

  return (
    <div
      className={cn(
        "border-b border-border bg-background px-4 py-4",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        <DimensionRadar base={base} live={live ?? undefined} size={180} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">
              {aggregate.toFixed(1)}
            </span>
            <span className="text-xs text-muted-foreground">/ 10</span>
            {frozen && (
              <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                frozen
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">
            {frozen
              ? "Final review generated. Score will not change."
              : "Score updates live as you decide on findings."}
          </div>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {DIMENSIONS_IN_ORDER.map((d) => (
              <DimensionRow
                key={d}
                dimension={d}
                base={base[d] ?? 0}
                live={live?.[d] ?? base[d] ?? 0}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function DimensionRow({
  dimension,
  base,
  live,
}: {
  dimension: Dimension;
  base: number;
  live: number;
}) {
  const delta = live - base;
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="truncate text-muted-foreground">
        {DIMENSION_LABELS[dimension]}
      </span>
      <span className="flex items-center gap-1.5 tabular-nums">
        <span className="text-foreground">{live.toFixed(1)}</span>
        {Math.abs(delta) >= 0.05 && (
          <span
            className={cn(
              "text-[10px]",
              delta < 0 ? "text-destructive" : "text-primary",
            )}
          >
            {delta > 0 ? "+" : ""}
            {delta.toFixed(1)}
          </span>
        )}
      </span>
    </li>
  );
}
