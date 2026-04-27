"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Copy,
  Download,
  Loader2,
  Pencil,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import {
  DIMENSIONS_IN_ORDER,
  DIMENSION_LABELS,
  DimensionRadar,
} from "@/components/workspace/dimension-radar";
import { useDerivedScores } from "@/lib/hooks/use-score";
import { usePaperFlagSetter } from "@/lib/hooks/use-paper-flag";
import type { Dimension, Paper, PaperFlag, TriageVerdict } from "@/lib/types";

const VERDICT_TONE: Record<TriageVerdict, string> = {
  high: "border-primary/30 bg-primary/10 text-primary",
  medium: "border-severity-medium/30 bg-severity-medium/10 text-severity-medium",
  low: "border-muted-foreground/30 bg-muted text-muted-foreground",
};
const VERDICT_LABEL: Record<TriageVerdict, string> = {
  high: "Worth a deep dive",
  medium: "Borderline — judgment call",
  low: "Probably skip",
};

const MD_COMPONENTS = {
  h1: (p: React.HTMLProps<HTMLHeadingElement>) => (
    <h1 {...p} className="mt-0 mb-3 text-xl font-semibold tracking-tight" />
  ),
  h2: (p: React.HTMLProps<HTMLHeadingElement>) => (
    <h2
      {...p}
      className="mt-5 mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
    />
  ),
  p: (p: React.HTMLProps<HTMLParagraphElement>) => (
    <p {...p} className="mb-3 text-sm leading-relaxed text-foreground" />
  ),
  ul: (p: React.HTMLProps<HTMLUListElement>) => (
    <ul {...p} className="mb-3 ml-5 list-disc space-y-1 text-sm leading-relaxed" />
  ),
  blockquote: (p: React.HTMLProps<HTMLQuoteElement>) => (
    <blockquote
      {...p}
      className="mb-3 border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground"
    />
  ),
};

/**
 * v3 unified Review Report. Single component, two render modes:
 *
 *   Stage 1 (paper.stage === "triaged"):
 *     - Composes a markdown report from paper.triage (scope, novelty,
 *       venue_match, summary). No dimension scores beyond relevance/novelty
 *       priors. Aggregate is informational.
 *     - Primary action: [✨ Run Stage 2 deep dive].
 *     - Secondary actions: [👍 Promising] [👎 Reject] [.md / .pdf / Copy].
 *
 *   Stage 2 (paper.stage === "dived"):
 *     - Pulls real dimension_scores from paper.dimension_scores +
 *       _adjust_scores overlay (live unless final_score is set).
 *     - Markdown either from the latest review draft (if generated) or
 *       a fallback assembled from triage + decision counts.
 *     - Primary action: [✏ Adjust by reviewing findings] flips the
 *       workspace into the PDF + finding-cards split.
 *     - Secondary action: [✨ Generate final review] which freezes the
 *       score and writes the canonical markdown.
 *
 * Same layout in both modes: radar on top, scores grid below, then
 * markdown body, then actions row.
 */
export function ReviewReport({
  paper,
  onAdjust,
}: {
  paper: Paper;
  /** Switch the workspace into the decision split (Stage 2 only). */
  onAdjust: () => void;
}) {
  const stage1 = paper.stage === "triaged";
  const stage2 = paper.stage === "dived";

  const { base, live, aggregate, frozen, findingCounts } = useDerivedScores(paper);
  const setFlag = usePaperFlagSetter();

  // Latest review draft — if Generate Final Review has been called, the
  // backend has a markdown body we should display verbatim. Stage 1 falls
  // back to a client-composed Markdown from triage fields.
  const latestDraftQ = useQuery({
    queryKey: ["latest-draft", paper.id, paper.final_score],
    queryFn: async () => {
      const list = await api.listReviews(paper.id);
      const newest = list[0];
      if (!newest) return null;
      return api.getReview(paper.id, newest.draft_id);
    },
    enabled: stage2,
    staleTime: 30_000,
  });

  const stage1Markdown = React.useMemo(
    () => composeStage1Markdown(paper),
    [paper],
  );

  const markdown = stage2
    ? latestDraftQ.data?.markdown ?? composeStage2Fallback(paper)
    : stage1Markdown;

  const [diving, setDiving] = React.useState(false);
  const [finalizing, setFinalizing] = React.useState(false);

  const goDeep = async () => {
    setDiving(true);
    try {
      await api.diveDeep(paper.id);
      toast.success("Deep dive started", {
        description: "Stage 2 work begins now — feel free to leave the page.",
      });
    } catch (e) {
      toast.error("Couldn't kick the deep dive", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setDiving(false);
    }
  };

  const finalize = async () => {
    setFinalizing(true);
    try {
      await api.finalizeReview(paper.id);
      toast.success("Final review generated", {
        description: `Score frozen at ${aggregate.toFixed(1)} / 10.`,
      });
    } catch (e) {
      toast.error("Couldn't finalize review", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setFinalizing(false);
    }
  };

  const flagToggle = (kind: PaperFlag) => () => {
    void setFlag(paper.id, paper.flag === kind ? null : kind);
  };

  const exportMd = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(paper.title || paper.filename).slice(0, 60).replace(/\s+/g, "_")}_review.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Saved .md");
  };
  const copyMd = async () => {
    await navigator.clipboard.writeText(markdown);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-6 pb-16 pt-6">
      {/* Stage banner + verdict */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>{stage1 ? "Stage 1 — Prescreened" : "Stage 2 — Deep dived"}</span>
          {paper.flag && (
            <span className="rounded-full border border-border bg-background px-1.5 text-[10px]">
              {paper.flag}
            </span>
          )}
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          {paper.title || paper.filename}
        </h1>
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

      {paper.triage && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-xl border px-4 py-3",
            VERDICT_TONE[paper.triage.verdict],
          )}
        >
          <div className="space-y-0.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80">
              Verdict · {paper.triage.verdict}
            </div>
            <div className="text-sm font-semibold">
              {VERDICT_LABEL[paper.triage.verdict]}
            </div>
          </div>
          <div className="text-right text-[11px] opacity-80">
            ${paper.triage.cost_usd.toFixed(3)}
          </div>
        </div>
      )}

      {/* Radar + dimension grid */}
      {base && (
        <section className="grid grid-cols-[220px_1fr] items-start gap-6 rounded-xl border border-border bg-background p-4 pl-8">
          <DimensionRadar base={base} live={live ?? undefined} size={180} />
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums">
                {aggregate.toFixed(1)}
              </span>
              <span className="text-xs text-muted-foreground">/ 10</span>
              {frozen ? (
                <span className="rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                  frozen
                </span>
              ) : stage2 ? (
                <span className="text-[11px] text-muted-foreground">live</span>
              ) : (
                <span className="text-[11px] text-muted-foreground">stage 1</span>
              )}
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              {DIMENSIONS_IN_ORDER.map((d) => (
                <DimensionRow
                  key={d}
                  dimension={d}
                  base={(base[d] ?? 0)}
                  live={live?.[d] ?? base[d] ?? 0}
                  isPrior={stage1 || (findingCounts[d] ?? 0) === 0}
                />
              ))}
            </ul>
            {stage1 && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Stage 2 deep dive fills in proof / literature / clarity / numerical
                from real findings and lets you adjust the score.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Markdown body — same surface for Stage 1 and Stage 2 */}
      <section className="rounded-xl border border-border bg-card p-5">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={MD_COMPONENTS}
        >
          {markdown}
        </ReactMarkdown>
      </section>

      {/* Actions */}
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant={paper.flag === "promising" ? "default" : "outline"}
            onClick={flagToggle("promising")}
          >
            <ThumbsUp className="size-3.5" />
            {paper.flag === "promising" ? "Marked promising" : "Promising"}
          </Button>
          <Button
            size="sm"
            variant={paper.flag === "rejected" ? "default" : "outline"}
            onClick={flagToggle("rejected")}
          >
            <ThumbsDown className="size-3.5" />
            {paper.flag === "rejected" ? "Rejected" : "Reject"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={copyMd}>
            <Copy className="size-3.5" /> Copy
          </Button>
          <Button size="sm" variant="outline" onClick={exportMd}>
            <Download className="size-3.5" /> .md
          </Button>
          {stage1 ? (
            <Button size="sm" onClick={goDeep} disabled={diving}>
              {diving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Sparkles className="size-3.5" />
              )}
              Run Stage 2 deep dive
              <ArrowRight className="size-3.5" />
            </Button>
          ) : (
            <>
              <Button size="sm" variant="outline" onClick={onAdjust}>
                <Pencil className="size-3.5" /> Adjust by reviewing findings
              </Button>
              <Button
                size="sm"
                onClick={finalize}
                disabled={finalizing || frozen}
                title={
                  frozen
                    ? "Score already frozen"
                    : "Freeze the score and produce the final review"
                }
              >
                {finalizing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Sparkles className="size-3.5" />
                )}
                {frozen ? `Finalized (${aggregate.toFixed(1)})` : "Generate final review"}
              </Button>
            </>
          )}
        </div>
      </footer>
    </div>
  );
}

function DimensionRow({
  dimension,
  base,
  live,
  isPrior,
}: {
  dimension: Dimension;
  base: number;
  live: number;
  isPrior: boolean;
}) {
  const delta = live - base;
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span className="truncate text-muted-foreground">
        {DIMENSION_LABELS[dimension]}
      </span>
      <span className="flex items-baseline gap-1.5 tabular-nums">
        <span className="text-sm font-medium text-foreground">{live.toFixed(1)}</span>
        {isPrior ? (
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            prior
          </span>
        ) : Math.abs(delta) >= 0.05 ? (
          <span
            className={cn(
              "text-[10px]",
              delta < 0 ? "text-destructive" : "text-primary",
            )}
          >
            {delta > 0 ? "+" : ""}
            {delta.toFixed(1)}
          </span>
        ) : null}
      </span>
    </li>
  );
}

// ---- Stage 1 markdown composer -------------------------------------------

function composeStage1Markdown(paper: Paper): string {
  const t = paper.triage;
  if (!t) return "_Triage not yet available._";
  const titleish = paper.title || paper.filename;
  const lines: string[] = [];
  lines.push(`# Stage 1 review · ${titleish}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(t.summary);
  lines.push("");
  lines.push("## Scope");
  lines.push(t.scope);
  lines.push("");
  lines.push("## Novelty (vs prior work)");
  lines.push(t.novelty);
  lines.push("");
  lines.push(`## Fit to ${paper.venue_name || "the declared venue"}`);
  lines.push(t.venue_match);
  lines.push("");
  lines.push("---");
  lines.push(
    "_Stage 1 is a quick prescreen. Run **Stage 2 deep dive** to add proof / literature / clarity / numerical analysis and adjust the score._",
  );
  return lines.join("\n");
}

// ---- Stage 2 fallback (shown until Generate Final Review runs) -----------

function composeStage2Fallback(paper: Paper): string {
  const agreed = paper.findings.filter((f) => f.decision === "agree").length;
  const dismissed = paper.findings.filter((f) => f.decision === "dismiss").length;
  const total = paper.findings.length;
  const decided = agreed + dismissed;
  const titleish = paper.title || paper.filename;
  const lines: string[] = [];
  lines.push(`# Stage 2 review · ${titleish}`);
  lines.push("");
  lines.push(`_${decided} of ${total} findings decided. Click **Generate final review** to produce the canonical markdown._`);
  lines.push("");
  if (paper.triage) {
    lines.push("## Summary");
    lines.push(paper.triage.summary);
    lines.push("");
  }
  lines.push("## Findings overview");
  lines.push(`- **${total}** flagged across the dive`);
  lines.push(`- **${agreed}** agreed (counted toward the score)`);
  lines.push(`- **${dismissed}** dismissed (small +0.1 credit each)`);
  lines.push(`- **${total - decided}** undecided (no score impact yet)`);
  lines.push("");
  lines.push(
    "_Click **Adjust by reviewing findings** to inspect individual cards alongside the PDF._",
  );
  return lines.join("\n");
}
