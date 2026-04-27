"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { useActivityLog, type ActivityEvent } from "@/lib/hooks/use-activity-log";
import type { Paper } from "@/lib/types";

// Stable reference so the zustand selector returns the same value across
// renders when the paper has no events yet. A fresh `[]` each call would
// make zustand think state changed and loop infinitely.
const EMPTY_EVENTS: readonly ActivityEvent[] = [];

const KIND_COLOR: Record<string, string> = {
  outline: "bg-muted-foreground/40",
  segment: "bg-primary/60",
  finding: "bg-highlight/80",
  localize: "bg-brand/60",
  cost: "bg-muted-foreground/40",
  run: "bg-primary",
  step: "bg-primary/40",
};

/**
 * A collapsible strip that shows a rolling feed of analysis events for one
 * paper. Visible when the paper is still being analyzed OR when the user
 * explicitly opens it. Subscribes to the in-memory activity log populated by
 * useAnalysisStream — events survive navigation within a single session.
 */
export function ActivityStrip({ paper }: { paper: Paper }) {
  const events = useActivityLog(
    React.useCallback(
      (s) => s.events[paper.id] ?? (EMPTY_EVENTS as ActivityEvent[]),
      [paper.id],
    ),
  );
  const analyzing =
    paper.status === "analyzing" ||
    (paper.run_state && paper.run_state !== "completed" && paper.run_state !== "idle");
  const completed =
    paper.status === "ready" || paper.run_state === "completed";
  const [open, setOpen] = React.useState<boolean>(!!analyzing);

  // Auto-open the strip if analysis kicks off while the strip is closed.
  React.useEffect(() => {
    if (analyzing) setOpen(true);
  }, [analyzing]);

  const latest = events[0];
  const recap = completed ? synthesizeRecap(paper) : null;
  const preview = latest
    ? latest.message
    : analyzing
      ? "Waiting for the first event…"
      : recap
        ? recap
        : "No recent activity.";

  return (
    <div
      className={cn(
        "relative z-10 w-full shrink-0 overflow-hidden border-t border-border bg-background transition-all duration-200",
        open ? "h-[200px]" : "h-9"
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center gap-3 px-5 text-xs transition-colors hover:bg-muted/40"
        aria-expanded={open}
        aria-controls="activity-strip-body"
      >
        <Activity
          className={cn(
            "size-3.5 shrink-0",
            analyzing ? "animate-pulse text-primary" : "text-muted-foreground"
          )}
        />
        <span className="shrink-0 font-medium text-foreground">Activity</span>
        <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
          {preview}
        </span>
        {events.length > 0 && (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {events.length} event{events.length === 1 ? "" : "s"}
          </span>
        )}
        <span className="shrink-0 text-muted-foreground">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            id="activity-strip-body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="h-[160px] w-full space-y-1 overflow-y-auto border-t border-border px-5 py-3"
          >
            {events.length === 0 ? (
              <li className="py-2 text-xs text-muted-foreground">
                {analyzing
                  ? "Connecting to the analysis stream…"
                  : recap
                    ? `${recap}. Live activity only streams while analyzing — future runs will appear here.`
                    : "Nothing to show yet."}
              </li>
            ) : (
              events.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start gap-2 text-xs tabular-nums"
                >
                  <span
                    className={cn(
                      "mt-1 size-1.5 shrink-0 rounded-full",
                      KIND_COLOR[e.kind] ?? "bg-muted-foreground/40"
                    )}
                  />
                  <span className="w-14 shrink-0 text-muted-foreground">
                    {fmtTime(e.ts)}
                  </span>
                  <span className="min-w-0 flex-1 text-foreground">
                    {e.message}
                  </span>
                </li>
              ))
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

function synthesizeRecap(paper: Paper): string | null {
  const findings = paper.findings.length;
  const runtimeMs = runtimeOf(paper);
  const parts = [`Scan complete`, `${findings} finding${findings === 1 ? "" : "s"}`];
  if (runtimeMs) parts.push(fmtDuration(runtimeMs));
  return parts.join(" · ");
}

function runtimeOf(paper: Paper): number | null {
  if (!paper.created_at) return null;
  const start = Date.parse(paper.created_at);
  const segEnd = (paper.segments ?? [])
    .map((s) => s.finished_at)
    .filter((x): x is string => !!x)
    .map((x) => Date.parse(x))
    .filter((n) => !Number.isNaN(n))
    .reduce((a, b) => (b > a ? b : a), 0);
  const end = segEnd || (paper.updated_at ? Date.parse(paper.updated_at) : 0);
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

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
