"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { Dimension } from "@/lib/types";

const DIMENSION_ORDER: Dimension[] = [
  "proof",
  "literature",
  "clarity",
  "numerical",
  "relevance",
  "novelty",
];

const LABELS: Record<Dimension, string> = {
  proof: "Proof",
  literature: "Literature",
  clarity: "Clarity",
  numerical: "Numerical",
  relevance: "Relevance",
  novelty: "Novelty",
};

/**
 * A 6-axis radar plotted as an SVG hexagon. Two layers:
 *   - "live"   = current scores after user adjustments (filled, brand color)
 *   - "base"   = scores from the deep-dive pass (outline only, muted)
 * Both arrays must contain a value for every dimension (0..10). Values are
 * clamped + cast to numbers; ordering follows DIMENSION_ORDER, not input.
 */
export function DimensionRadar({
  base,
  live,
  size = 220,
  className,
}: {
  base: Partial<Record<Dimension, number>>;
  live?: Partial<Record<Dimension, number>>;
  size?: number;
  className?: string;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 32; // leave room for axis labels

  const axisPoints = DIMENSION_ORDER.map((_, i) =>
    polar(cx, cy, radius, axisAngle(i)),
  );

  const basePoints = DIMENSION_ORDER.map((d, i) => {
    const v = clamp(base[d] ?? 0, 0, 10);
    return polar(cx, cy, (radius * v) / 10, axisAngle(i));
  });
  const livePoints = live
    ? DIMENSION_ORDER.map((d, i) => {
        const v = clamp(live[d] ?? base[d] ?? 0, 0, 10);
        return polar(cx, cy, (radius * v) / 10, axisAngle(i));
      })
    : null;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      // overflow: visible so axis labels ("Literature", "Relevance", "Numerical")
      // render past the viewBox edge instead of getting truncated. The grid gap
      // around the radar leaves enough breathing room for the text.
      style={{ overflow: "visible" }}
      className={cn("text-muted-foreground", className)}
      role="img"
      aria-label="Dimension scores radar"
    >
      {/* Concentric guides at 2.5 / 5 / 7.5 / 10. */}
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <polygon
          key={t}
          points={DIMENSION_ORDER.map((_, i) => {
            const p = polar(cx, cy, radius * t, axisAngle(i));
            return `${p.x},${p.y}`;
          }).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeOpacity={t === 1 ? 0.35 : 0.12}
          strokeWidth={1}
        />
      ))}

      {/* Axes. */}
      {axisPoints.map((p, i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={p.x}
          y2={p.y}
          stroke="currentColor"
          strokeOpacity={0.18}
          strokeWidth={1}
        />
      ))}

      {/* Base shape (outline only). */}
      <polygon
        points={basePoints.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.55}
        strokeWidth={1.5}
        strokeDasharray="3 3"
      />

      {/* Live shape, if provided. We use stroke="currentColor" + fill via the
          adjacent <g> CSS so the brand emerald is picked up from `text-primary`
          on the wrapper. The previous `hsl(var(--primary))` was wrong because
          --primary is OKLCH-formatted in this design system. */}
      {livePoints && (
        <g className="text-primary">
          <polygon
            points={livePoints.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="currentColor"
            fillOpacity={0.18}
            stroke="currentColor"
            strokeWidth={2}
          />
        </g>
      )}

      {/* Labels at each axis tip. */}
      {DIMENSION_ORDER.map((d, i) => {
        const tip = polar(cx, cy, radius + 16, axisAngle(i));
        const anchor: "start" | "middle" | "end" =
          Math.abs(tip.x - cx) < 1 ? "middle" : tip.x < cx ? "end" : "start";
        return (
          <text
            key={d}
            x={tip.x}
            y={tip.y}
            textAnchor={anchor}
            dominantBaseline="middle"
            className="fill-foreground text-[10px] font-medium"
          >
            {LABELS[d]}
          </text>
        );
      })}
    </svg>
  );
}

function axisAngle(i: number): number {
  // -π/2 → top axis is "Proof" at 12 o'clock; rotate clockwise.
  return -Math.PI / 2 + (i * 2 * Math.PI) / DIMENSION_ORDER.length;
}

function polar(cx: number, cy: number, r: number, theta: number) {
  return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
}

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

export const DIMENSIONS_IN_ORDER = DIMENSION_ORDER;
export const DIMENSION_LABELS = LABELS;
