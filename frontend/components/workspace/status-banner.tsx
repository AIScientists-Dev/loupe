"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Loader2, Check, Pause } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Paper } from "@/lib/types";

/**
 * Plain-English derived status string — no segment IDs, no jargon.
 * Sits in the workspace header between title and run controls.
 */
export function StatusBanner({ paper }: { paper: Paper }) {
  const isNarrow = useIsNarrow();
  const runState = paper.run_state ?? "idle";
  const active = (paper.segments ?? []).find((s) =>
    ["parsing", "extracting", "verifying", "localizing"].includes(s.status)
  );
  const lastDone = [...(paper.segments ?? [])]
    .reverse()
    .find((s) => s.status === "done");
  const done = (paper.segments ?? []).filter((s) => s.status === "done").length;
  const total = (paper.segments ?? []).filter((s) => s.status !== "skipped")
    .length;

  // v3: when the paper is sitting in Stage 1 (triaged, waiting for the user
  // to decide whether to dive), the report card shows the verdict — no need
  // for a separate StatusBanner chip. Suppress to avoid the misleading
  // "Queued…" rotating copy.
  if (paper.stage === "triaged") {
    return null;
  }

  if (runState === "completed" || paper.status === "ready") {
    const withFindings = paper.findings.length;
    const durationMs = durationMsOf(paper);
    return <ScanCompleteDot findings={withFindings} durationMs={durationMs} />;
  }

  if (runState === "stopped" || runState === "paused") {
    const last = lastDone?.page_end ?? 0;
    const remaining = (paper.segments ?? []).filter((s) => s.status === "pending")
      .length;
    const label = `Stopped at p.${last || "—"} · ${remaining} range${remaining === 1 ? "" : "s"} queued`;
    return (
      <Chip icon={<Pause className="size-3.5" />} tone="warning" compact={isNarrow} title={label}>
        {label}
      </Chip>
    );
  }

  if (runState === "running" && active) {
    const verb =
      active.status === "parsing"
        ? "Reading"
        : active.status === "extracting"
          ? "Extracting proofs"
          : active.status === "verifying"
            ? "Checking"
            : "Localizing";
    const label = `${verb} ${humanLabel(active.classification)} · p.${active.page_start}–${active.page_end}`;
    return (
      <Chip
        icon={<Loader2 className="size-3.5 animate-spin" />}
        tone="active"
        compact={isNarrow}
        title={label}
      >
        {label}
      </Chip>
    );
  }

  if (runState === "running") {
    return <RotatingChip copy={PLANNING_COPY} compact={isNarrow} />;
  }

  if (runState === "idle" || !active) {
    return <RotatingChip copy={QUEUED_COPY} compact={isNarrow} />;
  }

  return null;
}

function RotatingChip({ copy, compact }: { copy: string[]; compact: boolean }) {
  const label = useRotatingCopy(copy);
  return (
    <Chip
      icon={<Loader2 className="size-3.5 animate-spin" />}
      tone="active"
      compact={compact}
      title={label}
    >
      {label}
    </Chip>
  );
}

// Verbs we cycle through while the pipeline is alive but hasn't reached a
// concrete segment yet. Purely cosmetic — nothing connects these to the real
// backend state. Their only job: reassure the user it's not stuck.
const QUEUED_COPY = [
  "Queued…",
  "Waking up the pipeline…",
  "Opening the paper…",
];

const PLANNING_COPY = [
  "Reading outline…",
  "Planning segments…",
  "Starting first range…",
];

function useRotatingCopy(copy: string[], intervalMs = 2500): string {
  const [i, setI] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setI((x) => (x + 1) % copy.length), intervalMs);
    return () => clearInterval(id);
  }, [copy, intervalMs]);
  return copy[i];
}

function humanLabel(c: string): string {
  switch (c) {
    case "proof":
      return "proofs";
    case "theorem":
      return "theorems";
    case "background":
      return "background";
    case "experiment":
      return "experiments";
    case "figures":
      return "figures";
    default:
      return "pages";
  }
}

function useIsNarrow(breakpoint = 768) {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [breakpoint]);
  return narrow;
}

function ScanCompleteDot({
  findings,
  durationMs,
}: {
  findings: number;
  durationMs: number | null;
}) {
  const isNarrow = useIsNarrow();
  const summary =
    `${findings} finding${findings === 1 ? "" : "s"}` +
    (durationMs ? ` · ${fmtDuration(durationMs)}` : "");
  const title = `Scan complete · ${summary}`;
  return (
    <span
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 text-xs font-medium text-primary",
        isNarrow ? "size-5 justify-center" : "px-2.5 py-0.5"
      )}
    >
      <Check className="size-3" />
      {!isNarrow && <span>Scan complete — {summary}</span>}
    </span>
  );
}

function durationMsOf(paper: Paper): number | null {
  if (!paper.created_at) return null;
  const start = Date.parse(paper.created_at);
  const endStr = paper.updated_at;
  // Prefer the last finished segment's timestamp if richer than updated_at.
  const segEnd = (paper.segments ?? [])
    .map((s) => s.finished_at)
    .filter((x): x is string => !!x)
    .map((x) => Date.parse(x))
    .filter((n) => !Number.isNaN(n))
    .reduce((a, b) => (b > a ? b : a), 0);
  const end = segEnd || (endStr ? Date.parse(endStr) : 0);
  if (!end || Number.isNaN(start) || end <= start) return null;
  return end - start;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs === 0 ? `${m}m` : `${m}m ${rs}s`;
}

function Chip({
  icon,
  tone,
  children,
  compact,
  title,
}: {
  icon: React.ReactNode;
  tone: "active" | "success" | "warning" | "neutral";
  children: React.ReactNode;
  compact?: boolean;
  title?: string;
}) {
  return (
    <motion.span
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border text-xs font-medium",
        compact ? "size-6 justify-center" : "px-2.5 py-0.5",
        tone === "active" && "border-primary/30 bg-primary/10 text-primary",
        tone === "success" && "border-primary/30 bg-primary/10 text-primary",
        tone === "warning" && "border-severity-medium/30 bg-severity-medium/10 text-severity-medium",
        tone === "neutral" && "border-border bg-muted text-muted-foreground"
      )}
    >
      {icon}
      {!compact && children}
    </motion.span>
  );
}
