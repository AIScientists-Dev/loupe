"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Loader2, Check, Pause, XCircle, FileSearch } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Paper } from "@/lib/types";

/**
 * Plain-English derived status string — no segment IDs, no jargon.
 * Sits in the workspace header between title and run controls.
 */
export function StatusBanner({ paper }: { paper: Paper }) {
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

  if (runState === "completed" || paper.status === "ready") {
    const withFindings = paper.findings.length;
    return (
      <Chip icon={<Check className="size-3.5" />} tone="success">
        Scan complete — {withFindings} finding{withFindings === 1 ? "" : "s"}
      </Chip>
    );
  }

  if (runState === "stopped" || runState === "paused") {
    const last = lastDone?.page_end ?? 0;
    const remaining = (paper.segments ?? []).filter((s) => s.status === "pending")
      .length;
    return (
      <Chip icon={<Pause className="size-3.5" />} tone="warning">
        Stopped at p.{last || "—"} · {remaining} range{remaining === 1 ? "" : "s"} queued
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
    return (
      <Chip
        icon={<Loader2 className="size-3.5 animate-spin" />}
        tone="active"
      >
        {verb} {humanLabel(active.classification)} · p.{active.page_start}–{active.page_end}
      </Chip>
    );
  }

  if (runState === "running") {
    return (
      <Chip icon={<FileSearch className="size-3.5" />} tone="neutral">
        Reading outline…
      </Chip>
    );
  }

  if (runState === "idle" || !active) {
    return (
      <Chip icon={<FileSearch className="size-3.5" />} tone="neutral">
        Queued
      </Chip>
    );
  }

  return null;
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

function Chip({
  icon,
  tone,
  children,
}: {
  icon: React.ReactNode;
  tone: "active" | "success" | "warning" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <motion.span
      layout
      initial={{ opacity: 0, y: -2 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tone === "active" && "border-primary/30 bg-primary/10 text-primary",
        tone === "success" && "border-primary/30 bg-primary/10 text-primary",
        tone === "warning" && "border-severity-medium/30 bg-severity-medium/10 text-severity-medium",
        tone === "neutral" && "border-border bg-muted text-muted-foreground"
      )}
    >
      {icon}
      {children}
    </motion.span>
  );
}
