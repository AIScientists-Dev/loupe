"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  CircleDollarSign,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePaperCost } from "@/lib/hooks/use-papers";
import { useCostDrawer } from "@/lib/hooks/use-cost-drawer";
import { useSettings } from "@/lib/hooks/use-settings";
import type { CostReport, Paper } from "@/lib/types";

// Display metadata for each known stage bucket the backend may emit.
// Unknown keys fall back to a grey bar + title-cased label.
const STAGE_META: Record<string, { label: string; color: string }> = {
  outline: { label: "Outline", color: "bg-muted-foreground/40" },
  mineru_gpu: { label: "Parse (GPU)", color: "bg-brand/60" },
  llm: { label: "LLM (extract + verify + localize)", color: "bg-primary/60" },
  extract: { label: "Extract proofs", color: "bg-primary/40" },
  verify: { label: "Verify proofs", color: "bg-primary/70" },
  localize: { label: "Localize", color: "bg-highlight/80" },
};
const stageLabel = (k: string) =>
  STAGE_META[k]?.label ?? k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const stageColor = (k: string) => STAGE_META[k]?.color ?? "bg-muted-foreground/40";

export function CostDrawer({ paper }: { paper: Paper }) {
  const { open, setOpen } = useCostDrawer();
  const { data: cost } = usePaperCost(paper.id, true);
  const budgetCap = useSettings((s) => s.defaultBudgetCapUsd);

  const billed = cost?.running_billed_usd ?? 0;
  const ratio = budgetCap > 0 ? billed / budgetCap : 0;

  return (
    <div
      className={cn(
        "relative z-20 w-full shrink-0 overflow-hidden border-t border-border bg-background transition-all duration-200",
        open ? "h-[280px]" : "h-10"
      )}
    >
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-3 px-5 text-xs transition-colors hover:bg-muted/40"
        )}
        aria-expanded={open}
        aria-controls="cost-drawer-body"
      >
        <div className="flex items-center gap-2">
          <CircleDollarSign className="size-3.5 text-muted-foreground" />
          <span className="font-medium text-foreground">
            ${billed.toFixed(2)}
          </span>
          {budgetCap > 0 && (
            <span className="text-muted-foreground">
              of ${budgetCap.toFixed(2)} cap
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {budgetCap > 0 && (
            <BudgetBar ratio={ratio} />
          )}
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            {open ? "Hide" : "Details"}
            {open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronUp className="size-3.5" />
            )}
          </span>
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && cost && (
          <motion.div
            id="cost-drawer-body"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="grid h-[240px] w-full grid-cols-[minmax(0,1fr)_260px] gap-6 overflow-hidden border-t border-border px-5 py-4"
          >
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Cost by stage
              </div>
              <div className="flex h-5 w-full overflow-hidden rounded-md bg-muted">
                {Object.keys(cost.by_stage ?? {}).map((k) => {
                  const amount = (cost.by_stage[k] ?? 0) * (cost.markup_factor ?? 1);
                  const width = billed > 0 ? (amount / billed) * 100 : 0;
                  if (width === 0) return null;
                  return (
                    <div
                      key={k}
                      className={cn("h-full", stageColor(k))}
                      style={{ width: `${width}%` }}
                      title={`${stageLabel(k)}: $${amount.toFixed(4)}`}
                    />
                  );
                })}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                {Object.keys(cost.by_stage ?? {}).map((k) => (
                  <div key={k} className="flex items-center justify-between">
                    <dt className="flex items-center gap-1.5 text-muted-foreground">
                      <span
                        className={cn("size-2 rounded-sm", stageColor(k))}
                      />
                      {stageLabel(k)}
                    </dt>
                    <dd className="tabular-nums text-foreground">
                      ${((cost.by_stage[k] ?? 0) * (cost.markup_factor ?? 1)).toFixed(4)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            <div className="space-y-3 border-l border-border pl-6 text-xs">
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Tokens
                </div>
                <dl className="space-y-0.5 tabular-nums">
                  <Row
                    k="Input"
                    v={(cost.llm_tokens?.input ?? 0).toLocaleString()}
                  />
                  <Row
                    k="Cached"
                    v={(cost.llm_tokens?.cache_read ?? 0).toLocaleString()}
                  />
                  <Row
                    k="Output"
                    v={(cost.llm_tokens?.output ?? 0).toLocaleString()}
                  />
                </dl>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Progress
                </div>
                <dl className="space-y-0.5 tabular-nums">
                  <Row
                    k="Ranges done"
                    v={`${(paper.segments ?? []).filter((s) => s.status === "done").length} of ${(paper.segments ?? []).filter((s) => s.status !== "skipped").length}`}
                  />
                  <Row k="Findings" v={String(paper.findings.length)} />
                </dl>
              </div>
              <div className="border-t border-border pt-2 text-[11px] text-muted-foreground">
                Costs meter from actual token + GPU usage.{" "}
                <Link
                  href="https://github.com/morphmind/loupe/blob/main/backend/app/services/pricing.py"
                  target="_blank"
                  className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
                >
                  Source <ExternalLink className="size-2.5" />
                </Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-foreground">{v}</dd>
    </div>
  );
}

function BudgetBar({ ratio }: { ratio: number }) {
  const pct = Math.min(100, ratio * 100);
  const tone =
    ratio >= 1
      ? "bg-destructive"
      : ratio >= 0.8
        ? "bg-severity-medium"
        : "bg-primary";
  return (
    <div
      className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"
      aria-label={`Budget used: ${Math.round(pct)}%`}
    >
      <div
        className={cn("h-full transition-all", tone)}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
