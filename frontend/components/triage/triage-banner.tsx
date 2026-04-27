"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Paper, TriageVerdict } from "@/lib/types";
import { usePaperFlags } from "@/lib/hooks/use-paper-flag";

const VERDICT_TONE: Record<TriageVerdict, string> = {
  high: "border-primary/30 bg-primary/5 text-primary",
  medium: "border-severity-medium/30 bg-severity-medium/5 text-severity-medium",
  low: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
};

const VERDICT_LABEL: Record<TriageVerdict, string> = {
  high: "Worth a deep dive",
  medium: "Borderline — judgment call",
  low: "Probably skip",
};

/**
 * Inline triage surface shown at the top of the workspace. Replaces the
 * prior full-screen TriageCard gate — the user always lands in the
 * workspace, sees the triage summary inline, and can dive deep without
 * leaving the page.
 *
 * Collapsed by default once the paper has progressed past triage so the
 * PDF + findings panel get full real estate. Expandable via the chevron.
 */
export function TriageBanner({ paper }: { paper: Paper }) {
  // Poll triage while it's running. Once we have a report, useQuery caches it
  // and stops polling (refetchInterval disables itself when data is set).
  const triageQuery = useQuery({
    queryKey: ["triage", paper.id],
    queryFn: () => api.getTriage(paper.id),
    enabled: !paper.triage && (paper.stage === "triaging" || paper.stage === "uploaded"),
    refetchInterval: (q) => (q.state.data ? false : 1500),
    initialData: paper.triage,
  });
  const triage = triageQuery.data;

  // Auto-collapse once the user has progressed past Screened — at that point
  // the radar + findings list is the primary surface.
  const isPostTriage = paper.stage === "diving" || paper.stage === "dived";
  const [open, setOpen] = React.useState(!isPostTriage);

  const setFlag = usePaperFlags((s) => s.set);
  const flag = usePaperFlags((s) => s.flags[paper.id] ?? null);

  const [diving, setDiving] = React.useState(false);

  const goDeep = async () => {
    setDiving(true);
    try {
      await api.diveDeep(paper.id);
      // Optimistic open while the run kicks off; status banner takes over.
      setOpen(false);
      toast.success("Deep dive started", {
        description: "Streaming activity will appear in the strip below.",
      });
    } catch (e) {
      toast.error("Couldn't kick the deep dive", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setDiving(false);
    }
  };

  if (!triage) {
    return paper.stage === "uploaded" || paper.stage === "triaging" ? (
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin text-primary" />
        Triaging — scope, novelty, fit verdict in ~1 min.
      </div>
    ) : null;
  }

  return (
    <div
      className={cn(
        "border-b border-border bg-background transition-all",
        open ? "" : "",
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full items-center gap-3 px-5 text-left text-xs transition-colors hover:bg-muted/40"
        aria-expanded={open}
      >
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide",
            VERDICT_TONE[triage.verdict],
          )}
        >
          Triage · {triage.verdict}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {VERDICT_LABEL[triage.verdict]}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {Math.round(triage.confidence * 100)}% confidence · ${triage.cost_usd.toFixed(3)}
        </span>
        {open ? (
          <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-4 border-t border-border px-5 pb-5 pt-4 text-sm">
          <Section label="Scope">{triage.scope}</Section>
          <Section label="Novelty (vs prior work)">{triage.novelty}</Section>
          <Section label={`Fit to ${paper.venue_name || "venue"}`}>{triage.venue_match}</Section>
          <Section label="Reviewer summary">{triage.summary}</Section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant={flag === "promising" ? "default" : "outline"}
                onClick={() =>
                  setFlag(paper.id, flag === "promising" ? null : "promising")
                }
                className="gap-1.5"
              >
                <ThumbsUp className="size-3.5" />
                {flag === "promising" ? "Marked promising" : "Promising"}
              </Button>
              <Button
                size="sm"
                variant={flag === "rejected" ? "default" : "outline"}
                onClick={() =>
                  setFlag(paper.id, flag === "rejected" ? null : "rejected")
                }
                className="gap-1.5"
              >
                <ThumbsDown className="size-3.5" />
                {flag === "rejected" ? "Rejected" : "Reject"}
              </Button>
            </div>
            {paper.stage === "triaged" && (
              <Button size="sm" onClick={goDeep} disabled={diving} className="gap-1.5">
                {diving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                Dive deep
              </Button>
            )}
            {(paper.stage === "diving" || paper.stage === "dived") && (
              <span className="text-[11px]">
                Deep dive {paper.stage === "diving" ? "in progress" : "complete"}.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <p className="text-sm leading-relaxed text-foreground">{children}</p>
    </div>
  );
}
