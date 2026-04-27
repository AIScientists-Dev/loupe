"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, X, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Paper, TriageReport, TriageVerdict } from "@/lib/types";

const VERDICT_COPY: Record<
  TriageVerdict,
  { label: string; tone: string; sub: string }
> = {
  high: {
    label: "Worth a deep dive",
    tone: "border-primary/40 bg-primary/10 text-primary",
    sub: "Strong fit + non-trivial contribution. Recommended.",
  },
  medium: {
    label: "Borderline — judgment call",
    tone: "border-severity-medium/40 bg-severity-medium/10 text-severity-medium",
    sub: "Some concerns. Skim before committing reviewer time.",
  },
  low: {
    label: "Probably skip",
    tone: "border-muted-foreground/30 bg-muted text-muted-foreground",
    sub: "Weak fit or thin contribution. Dismiss unless you disagree.",
  },
};

/**
 * Stage-1 review surface. Shown immediately after upload while triage runs;
 * once the report lands, the editor decides whether to dive deeper. Non-
 * destructive — the paper sits in "triaged" until the editor commits.
 */
export function TriageCard({
  paper,
  onDiveDeep,
  onDismiss,
}: {
  paper: Paper;
  /** Called after diveDeep mutation succeeds — parent should route into the workspace. */
  onDiveDeep: () => void;
  /** Called when user dismisses without diving — parent decides whether to delete or just navigate away. */
  onDismiss: () => void;
}) {
  // Poll the triage endpoint until it returns 200. Once we have a report,
  // useQuery caches it and stops re-fetching (we use refetchInterval that
  // disables itself).
  const triageQuery = useQuery({
    queryKey: ["triage", paper.id],
    queryFn: () => api.getTriage(paper.id),
    enabled: !paper.triage,
    refetchInterval: (q) => (q.state.data ? false : 1500),
    initialData: paper.triage,
  });
  const triage = triageQuery.data;

  const [diving, setDiving] = React.useState(false);
  const goDeep = async () => {
    setDiving(true);
    try {
      await api.diveDeep(paper.id);
      onDiveDeep();
    } catch (e) {
      toast.error("Couldn't kick the deep dive", {
        description: e instanceof Error ? e.message : undefined,
      });
      setDiving(false);
    }
  };

  if (!triage) return <TriageLoading filename={paper.filename} />;

  const v = VERDICT_COPY[triage.verdict];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="space-y-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Stage 1 · Triage
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{paper.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">{paper.filename}</span>
          {paper.venue_name && (
            <>
              <span>·</span>
              <span>{paper.venue_name}</span>
            </>
          )}
          {paper.venue_type && (
            <>
              <span>·</span>
              <span className="capitalize">{paper.venue_type}</span>
            </>
          )}
        </div>
      </header>

      <VerdictBadge verdict={triage.verdict} confidence={triage.confidence} />

      <div className="space-y-5">
        <Section label="Scope">{triage.scope}</Section>
        <Section label="Novelty (vs prior work)">{triage.novelty}</Section>
        <Section label={`Fit to ${paper.venue_name || "venue"}`}>
          {triage.venue_match}
        </Section>
        <Section label="Reviewer summary">{triage.summary}</Section>
      </div>

      <footer className="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-border pt-5 sm:flex-row sm:items-center">
        <div className="text-[11px] text-muted-foreground">
          Triage cost · ${triage.cost_usd.toFixed(3)} ·{" "}
          {new Date(triage.generated_at).toLocaleString()}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            <X className="size-3.5" /> Dismiss
          </Button>
          <Button
            size="sm"
            onClick={goDeep}
            disabled={diving}
            className={cn(
              "gap-1.5",
              triage.verdict === "high" && "shadow-sm",
            )}
          >
            {diving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Dive deep <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </footer>
    </div>
  );
}

function VerdictBadge({
  verdict,
  confidence,
}: {
  verdict: TriageVerdict;
  confidence: number;
}) {
  const v = VERDICT_COPY[verdict];
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-xl border px-5 py-4",
        v.tone,
      )}
    >
      <div className="space-y-0.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
          Verdict · {verdict}
        </div>
        <div className="text-base font-semibold">{v.label}</div>
        <div className="text-xs opacity-80">{v.sub}</div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[10px] uppercase tracking-wide opacity-70">
          Confidence
        </div>
        <div className="text-2xl font-semibold tabular-nums">
          {Math.round(confidence * 100)}
          <span className="text-base font-normal opacity-70">%</span>
        </div>
      </div>
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

function TriageLoading({ filename }: { filename: string }) {
  return (
    <div className="mx-auto grid w-full max-w-3xl place-items-center px-6 py-16">
      <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin text-primary" />
        <div>
          <div className="text-sm font-medium text-foreground">
            Triaging {filename}…
          </div>
          <div className="mt-1 text-xs">
            Scope, novelty, fit + a quick verdict — typically under a minute.
          </div>
        </div>
      </div>
    </div>
  );
}
