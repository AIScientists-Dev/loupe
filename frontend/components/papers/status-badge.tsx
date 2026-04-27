import * as React from "react";
import { Check, Loader2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PaperStatus, PaperSummary, ReviewStage } from "@/lib/types";

/**
 * v3.2: every card pill has the SAME anatomy — `[icon] Stage X · state`.
 *
 *   • Anchor: the stage number is always visible (Stage 1 / Stage 2). Even
 *     "Reviewed" reads as "Stage 2 · Reviewed" so the user always knows
 *     where the paper sits in the lifecycle.
 *   • Icon slot is fixed: spinner = running, dot = ready, check = reviewed,
 *     X = failed.
 *   • Tone is mnemonic: amber = running (wait), emerald = ready (your
 *     action is needed), violet = reviewed (closed), red = failed.
 *
 * The companion `phaseFor()` helper returns the same info plus a
 * `awaitingUser` boolean so PaperCard can render a "Review findings →"
 * CTA on cards that need attention.
 */

type Tone = "amber" | "emerald" | "violet" | "destructive";

const PILL_TONE: Record<Tone, string> = {
  amber: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  violet: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400",
  destructive: "border-destructive/30 bg-destructive/10 text-destructive",
};
const DOT_TONE: Record<Tone, string> = {
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  violet: "bg-violet-500",
  destructive: "bg-destructive",
};

type IconKind = "spin" | "dot" | "check" | "x";

export interface PhaseInfo {
  /** Full pill label, e.g. "Stage 2 · Reviewed". */
  label: string;
  tone: Tone;
  icon: IconKind;
  hint: string;
  /** True when the user can take a meaningful action by opening the paper.
   * PaperCard renders a "Review →" / "Read prescreen →" CTA when this is true
   * and `final_score` isn't set yet. */
  awaitingUser: boolean;
  /** Convenience for callers that want to pick CTA copy without re-reading
   * paper.stage. "triaged" → "Read prescreen", "dived" → "Review findings". */
  cta?: "read_prescreen" | "review_findings";
}

export function phaseFor(
  status: PaperStatus,
  paper?: Pick<PaperSummary, "stage" | "final_score">,
): PhaseInfo {
  if (status === "failed") {
    return {
      label: "Failed",
      tone: "destructive",
      icon: "x",
      hint: "Pipeline failed — open the paper to see the error.",
      awaitingUser: false,
    };
  }
  // null + undefined both mean "not finalized". Backend serializes
  // unfinalized papers with `"final_score": null`, not omitted.
  if (paper?.final_score != null) {
    return {
      label: "Stage 2 · Reviewed",
      tone: "violet",
      icon: "check",
      hint: "Final review generated. Score is frozen — the paper is closed.",
      awaitingUser: false,
    };
  }
  const stage = paper?.stage as ReviewStage | undefined;
  if (stage === "diving") {
    return {
      label: "Stage 2 · Diving",
      tone: "amber",
      icon: "spin",
      hint: "Stage 2 deep dive in progress — analyzing proofs, references, and numerics. This usually takes a few minutes.",
      awaitingUser: false,
    };
  }
  if (stage === "dived") {
    return {
      // No "· Ready" suffix — the emerald tone + the "Review →" CTA chip
      // on the right already carry that meaning. Keeping the pill short
      // lets the top row stay on one line on narrow cards.
      label: "Stage 2",
      tone: "emerald",
      icon: "dot",
      hint: "Deep dive complete. Open the paper to review findings and finalize.",
      awaitingUser: true,
      cta: "review_findings",
    };
  }
  if (stage === "triaged") {
    return {
      label: "Stage 1",
      tone: "emerald",
      icon: "dot",
      hint: "Triage complete. Open the paper to read the prescreen and run Stage 2.",
      awaitingUser: true,
      cta: "read_prescreen",
    };
  }
  if (stage === "uploaded" || stage === "triaging") {
    return {
      label: "Stage 1 · Triaging",
      tone: "amber",
      icon: "spin",
      hint: "Quick prescreen running — reads the abstract, scope, and venue fit.",
      awaitingUser: false,
    };
  }
  // Legacy fallback for papers without a stage field.
  if (status === "ready") {
    return {
      label: "Stage 2",
      tone: "emerald",
      icon: "dot",
      hint: "Analysis complete. Open the paper to review.",
      awaitingUser: true,
      cta: "review_findings",
    };
  }
  if (status === "analyzing" || status === "parsed" || status === "proofs_extracted") {
    return {
      label: "Stage 1 · Triaging",
      tone: "amber",
      icon: "spin",
      hint: "Pipeline running.",
      awaitingUser: false,
    };
  }
  return {
    label: "Queued",
    tone: "amber",
    icon: "spin",
    hint: "Waiting for pickup.",
    awaitingUser: false,
  };
}

export function StatusBadge({
  status,
  paper,
}: {
  status: PaperStatus;
  paper?: Pick<PaperSummary, "stage" | "final_score">;
}) {
  const info = phaseFor(status, paper);
  return (
    <span
      title={info.hint}
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium",
        PILL_TONE[info.tone],
      )}
    >
      <PhaseIcon kind={info.icon} tone={info.tone} />
      <span className="leading-none">{info.label}</span>
    </span>
  );
}

function PhaseIcon({ kind, tone }: { kind: IconKind; tone: Tone }) {
  if (kind === "spin") return <Loader2 className="size-3 shrink-0 animate-spin" />;
  if (kind === "check") return <Check className="size-3 shrink-0" strokeWidth={3} />;
  if (kind === "x") return <X className="size-3 shrink-0" strokeWidth={3} />;
  return (
    <span
      aria-hidden
      className={cn("size-1.5 shrink-0 rounded-full", DOT_TONE[tone])}
    />
  );
}
