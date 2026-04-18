"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SkipForward, X as XIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Finding, Segment } from "@/lib/types";

export type PageState =
  | "pending" // queued, not yet started
  | "scanning" // the "playhead" page — currently being parsed
  | "parsed" // in an active segment, behind the playhead
  | "done-empty" // segment completed, no finding on this page
  | "done-finding" // segment completed, at least one finding on this page
  | "skipped";

/**
 * Thumbnail / state strip for the full paper. Always visible. Per-page
 * state is derived from segments + findings; the "playhead" position
 * during a parsing segment is driven by mineru_seconds_per_page_estimate.
 */
export function PageStrip({
  totalPages,
  segments,
  findings,
  currentPage,
  onPageClick,
  onSkipSegment,
}: {
  totalPages: number;
  segments?: Segment[];
  findings: Finding[];
  currentPage: number;
  onPageClick: (page: number) => void;
  onSkipSegment?: (segmentId: string) => void;
}) {
  const [playheads, setPlayheads] = usePlayheads(segments);

  const stateByPage = React.useMemo(
    () => deriveStates(totalPages, segments, findings, playheads),
    [totalPages, segments, findings, playheads]
  );

  const findingByPage = React.useMemo(
    () => indexFindingsByPage(findings),
    [findings]
  );

  const pendingSegments = React.useMemo(
    () => (segments ?? []).filter((s) => s.status === "pending"),
    [segments]
  );

  if (totalPages === 0) return null;

  return (
    <div className="border-b border-border bg-muted/40">
      <div className="flex items-center gap-1 overflow-x-auto px-3 py-2">
        {Array.from({ length: totalPages }).map((_, i) => {
          const page = i + 1;
          const state = stateByPage[page - 1] ?? "pending";
          const topFinding = findingByPage.get(page);
          return (
            <PageCell
              key={page}
              page={page}
              state={state}
              active={page === currentPage}
              severity={topFinding?.severity}
              onClick={() => onPageClick(page)}
            />
          );
        })}
      </div>
      <AnimatePresence initial={false}>
        {onSkipSegment && pendingSegments.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-t border-border/60 bg-background/50"
          >
            <div className="flex items-center gap-2 overflow-x-auto px-3 py-2">
              <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Skip
              </span>
              {pendingSegments.map((seg) => (
                <button
                  key={seg.segment_id}
                  onClick={() => onSkipSegment(seg.segment_id)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                  title={`Don't analyze ${seg.label} (pages ${seg.page_start}–${seg.page_end})`}
                >
                  <SkipForward className="size-3" />
                  {seg.label} · p.{seg.page_start}–{seg.page_end}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PageCell({
  page,
  state,
  active,
  severity,
  onClick,
}: {
  page: number;
  state: PageState;
  active: boolean;
  severity?: Finding["severity"];
  onClick: () => void;
}) {
  const isScanning = state === "scanning";
  const isDoneFinding = state === "done-finding";
  const isSkipped = state === "skipped";

  return (
    <button
      onClick={onClick}
      title={labelFor(state, page)}
      aria-label={`Page ${page} — ${labelFor(state, page)}`}
      className={cn(
        "group relative flex h-10 w-[26px] shrink-0 flex-col items-center justify-end rounded-sm border transition-colors",
        active
          ? "border-primary/70 ring-2 ring-primary/20"
          : "border-border/70 hover:border-primary/40",
        state === "pending" && "bg-background/60 opacity-60",
        state === "parsed" && "bg-background",
        state === "done-empty" && "bg-background",
        isDoneFinding && "bg-background",
        isScanning && "bg-background",
        isSkipped && "bg-background/40 opacity-40"
      )}
    >
      {/* Severity dot (pages with findings) */}
      {isDoneFinding && severity && (
        <span
          className={cn(
            "absolute right-0.5 top-0.5 size-1.5 rounded-full",
            severity === "high" && "bg-severity-high",
            severity === "medium" && "bg-severity-medium",
            severity === "low" && "bg-severity-low"
          )}
        />
      )}

      {/* Scanning playhead ring */}
      {isScanning && (
        <motion.span
          initial={{ opacity: 0.5, scale: 1 }}
          animate={{ opacity: [0.5, 0.1, 0.5], scale: [1, 1.08, 1] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0 rounded-sm ring-2 ring-primary/60"
          aria-hidden
        />
      )}

      {/* Skipped strikethrough */}
      {isSkipped && (
        <span
          className="absolute left-0 right-0 top-1/2 h-px rotate-[-20deg] bg-muted-foreground/60"
          aria-hidden
        />
      )}

      {/* Page number */}
      <span
        className={cn(
          "select-none text-[9px] font-medium tabular-nums leading-none",
          isScanning ? "text-primary" : "text-muted-foreground",
          active && "text-foreground"
        )}
      >
        {page}
      </span>
    </button>
  );
}

function labelFor(state: PageState, page: number): string {
  switch (state) {
    case "pending":
      return `queued`;
    case "scanning":
      return `scanning now`;
    case "parsed":
      return `in progress`;
    case "done-empty":
      return `scanned — no finding`;
    case "done-finding":
      return `scanned — has finding`;
    case "skipped":
      return `skipped`;
  }
}

function indexFindingsByPage(findings: Finding[]): Map<number, Finding> {
  const m = new Map<number, Finding>();
  const order = { high: 0, medium: 1, low: 2 };
  for (const f of findings) {
    if (!f.bbox_page) continue;
    const existing = m.get(f.bbox_page);
    if (!existing || order[f.severity] < order[existing.severity]) {
      m.set(f.bbox_page, f);
    }
  }
  return m;
}

function deriveStates(
  totalPages: number,
  segments: Segment[] | undefined,
  findings: Finding[],
  playheads: Map<string, number>
): PageState[] {
  const out: PageState[] = new Array(totalPages).fill("pending");
  if (!segments) return out;
  const findingsByPage = indexFindingsByPage(findings);

  for (const seg of segments) {
    const playheadPage =
      playheads.get(seg.segment_id) ?? seg.page_start;

    for (let p = seg.page_start; p <= seg.page_end; p++) {
      const idx = p - 1;
      if (idx < 0 || idx >= totalPages) continue;

      if (seg.status === "skipped") {
        out[idx] = "skipped";
      } else if (seg.status === "done") {
        out[idx] = findingsByPage.has(p) ? "done-finding" : "done-empty";
      } else if (seg.status === "parsing") {
        out[idx] =
          p === playheadPage ? "scanning" : p < playheadPage ? "parsed" : "pending";
      } else if (
        seg.status === "extracting" ||
        seg.status === "verifying" ||
        seg.status === "localizing"
      ) {
        // Past parse — all pages in the segment are "in progress"
        out[idx] = "parsed";
      } else {
        out[idx] = "pending";
      }
    }
  }
  return out;
}

/**
 * Maintains per-segment "currently scanning" page. Ticks a 500ms interval
 * while any segment is parsing and advances the playhead based on
 * mineru_seconds_per_page_estimate. Snaps to page_end when the segment
 * leaves the parsing state.
 */
function usePlayheads(
  segments: Segment[] | undefined
): [Map<string, number>, (m: Map<string, number>) => void] {
  const [playheads, setPlayheads] = React.useState<Map<string, number>>(
    () => new Map()
  );

  const activeParsing = React.useMemo(
    () =>
      (segments ?? []).filter(
        (s) => s.status === "parsing" && !!s.started_at
      ),
    [segments]
  );

  React.useEffect(() => {
    if (activeParsing.length === 0) return;
    const tick = () => {
      setPlayheads((prev) => {
        const next = new Map(prev);
        const now = Date.now();
        for (const seg of activeParsing) {
          const startedMs = seg.started_at
            ? new Date(seg.started_at).getTime()
            : now;
          const secsPerPage =
            seg.mineru_seconds_per_page_estimate ?? 34;
          const elapsedSec = (now - startedMs) / 1000;
          const pagesDone = Math.floor(elapsedSec / secsPerPage);
          const playhead = Math.min(
            seg.page_end,
            seg.page_start + pagesDone
          );
          next.set(seg.segment_id, playhead);
        }
        return next;
      });
    };
    tick();
    const t = window.setInterval(tick, 500);
    return () => window.clearInterval(t);
  }, [activeParsing]);

  // Snap on parsing → !parsing transition
  React.useEffect(() => {
    if (!segments) return;
    setPlayheads((prev) => {
      const next = new Map(prev);
      for (const s of segments) {
        if (s.status !== "parsing" && next.has(s.segment_id)) {
          next.set(s.segment_id, s.page_end);
        }
      }
      return next;
    });
  }, [segments]);

  return [playheads, setPlayheads];
}
