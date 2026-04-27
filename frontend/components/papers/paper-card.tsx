"use client";

import * as React from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  FileText,
  Loader2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { StatusBadge, phaseFor } from "./status-badge";
import { cn } from "@/lib/utils";
import { useDeletePaper } from "@/lib/hooks/use-papers";
import { useBatchSelect } from "@/lib/hooks/use-batch-select";
import { usePaperFlag } from "@/lib/hooks/use-paper-flag";
import type { PaperSummary } from "@/lib/types";

export function PaperCard({ paper }: { paper: PaperSummary }) {
  const del = useDeletePaper();
  // Batch-select mode: when active, the entire card becomes a toggle
  // (preventDefault on the Link). Selection state drives the floating
  // action bar at the bottom of the library.
  const selectMode = useBatchSelect((s) => s.active);
  const selected = useBatchSelect(
    React.useCallback((s) => s.selected.has(paper.id), [paper.id]),
  );
  const toggleSelect = useBatchSelect((s) => s.toggle);
  const flag = usePaperFlag(paper.id);

  const subtitle = (() => {
    if (paper.status === "failed") return "Analysis failed";
    // v3: prefer stage-aware copy. The raw status stays "analyzing" through
    // Stage 1 too, which was the source of the misleading "Analyzing…" line.
    const stage = paper.stage;
    if (stage === "uploaded" || stage === "triaging") return "Triaging…";
    if (stage === "triaged") return "Awaiting deep dive";
    if (stage === "diving") return "Deep dive in progress…";
    if (stage === "dived" || paper.status === "ready") {
      const f = paper.finding_count;
      return `${f} finding${f === 1 ? "" : "s"} · ${paper.decided_count} decided`;
    }
    return "Analyzing…";
  })();

  const onDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const label = paper.title || paper.filename;
    if (!confirm(`Delete "${label}"? This cannot be undone.`)) return;
    try {
      await del.mutateAsync(paper.id);
      toast.success("Paper deleted");
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <Link
      href={`/papers/${paper.id}`}
      onClick={(e) => {
        if (selectMode) {
          e.preventDefault();
          toggleSelect(paper.id);
        }
      }}
      aria-pressed={selectMode ? selected : undefined}
      className={cn(
        "group relative flex flex-col gap-4 rounded-xl border bg-card p-5 transition-all",
        selectMode
          ? selected
            ? "border-primary bg-primary/5 shadow-sm"
            : "border-border hover:border-primary/40"
          : "border-border hover:border-primary/50 hover:shadow-md hover:-translate-y-0.5",
        del.isPending && "pointer-events-none opacity-60",
      )}
    >
      {/* Selection checkbox — only rendered in batch-select mode. Sits in
          the corner so it doesn't shift layout when toggling. */}
      {selectMode && (
        <div
          className={cn(
            "absolute left-3 top-3 grid size-5 place-items-center rounded border-2 transition-colors",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-muted-foreground/40 bg-background",
          )}
          aria-hidden
        >
          {selected && <Check className="size-3" strokeWidth={3} />}
        </div>
      )}

      {/* Top row — uniform across every card:
            LEFT: phase pill ("Stage X · state")
            RIGHT: score chip (when finalized) OR primary CTA chip (when the
                   paper is awaiting user action) OR nothing
          Flag (Promising / Rejected) lives in the footer row — it's a quiet
          verdict marker, not a top-row anchor.
          Hover reveals delete + open-arrow controls. */}
      <div className={cn("flex items-center justify-between gap-2", selectMode && "pl-7")}>
        <StatusBadge status={paper.status} paper={paper} />
        <div className="flex items-center gap-1.5">
          <RightSlot paper={paper} />
          {!selectMode && (
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={onDelete}
                aria-label="Delete paper"
                className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                {del.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
              </button>
              <span className="grid size-7 place-items-center text-muted-foreground">
                <ArrowUpRight className="size-4" />
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Title block — title may be null while triage is still extracting it.
          Render the filename (sans .pdf) in the same weight as a real title
          so a card with no extracted title doesn't look greyed out next to
          its neighbours. The mono filename stays in the footer below. */}
      <div className="flex min-h-[4.5rem] flex-col gap-1.5">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-foreground">
          {paper.title || paper.filename.replace(/\.pdf$/i, "")}
        </h3>
        <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
          <FileText className="size-3 shrink-0 text-muted-foreground/60" />
          <span className="truncate">{paper.filename}</span>
        </p>
      </div>

      {/* Footer row: optional flag + meta + time. Flag sits as a quiet
          marker on the left so the user can scan their verdicts without
          the top row getting busy. */}
      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
        <div className="flex min-w-0 items-center gap-1.5">
          {flag === "promising" && (
            <span
              title="Marked promising"
              aria-label="Marked promising"
              className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
            >
              <ThumbsUp className="size-2.5" />
            </span>
          )}
          {flag === "rejected" && (
            <span
              title="Marked rejected"
              aria-label="Marked rejected"
              className="inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
            >
              <ThumbsDown className="size-2.5" />
            </span>
          )}
          <span className="truncate">{subtitle}</span>
        </div>
        <span className="shrink-0 whitespace-nowrap">
          {formatDistanceToNow(new Date(paper.created_at), { addSuffix: true })}
        </span>
      </div>
    </Link>
  );
}

/**
 * Right-side chip on the card top row. Only one of three things shows:
 *   1. Frozen score chip — "✨ 7.3" — when finalize-review has run.
 *   2. Primary CTA chip — "Read prescreen →" / "Review findings →" — when
 *      the paper is parked at a stage that wants the user's attention. This
 *      is the "seduce me in" cue: emerald-tinted, action verb, arrow.
 *   3. Nothing — when the pipeline is mid-flight (Triaging / Diving) or in
 *      a state without a meaningful next step.
 *
 * Score and CTA are mutually exclusive — a frozen paper is closed, so the
 * score replaces the CTA.
 */
function RightSlot({ paper }: { paper: PaperSummary }) {
  if (paper.final_score != null) {
    return (
      <span
        title="Frozen aggregate score"
        className="inline-flex h-[22px] items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 text-[11px] font-medium tabular-nums text-violet-700 dark:text-violet-400"
      >
        <Sparkles className="size-2.5" />
        {paper.final_score.toFixed(1)}
      </span>
    );
  }
  const phase = phaseFor(paper.status, paper);
  if (!phase.awaitingUser) return null;
  // Short verbs only — the row already says "Stage 1" / "Stage 2", so the
  // CTA just confirms the next gesture. Long copy ("Read prescreen") used
  // to wrap the row to two lines on narrow cards.
  const label = phase.cta === "read_prescreen" ? "Read" : "Review";
  const longHint =
    phase.cta === "read_prescreen"
      ? "Open the paper to read the Stage 1 prescreen and decide on a deep dive"
      : "Open the paper to review findings and finalize the score";
  return (
    <span
      title={longHint}
      className="inline-flex h-[22px] items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 text-[11px] font-semibold text-primary"
    >
      {label}
      <ArrowRight className="size-3" />
    </span>
  );
}
