"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { CircleDollarSign } from "lucide-react";

import { cn } from "@/lib/utils";
import { usePaperCost } from "@/lib/hooks/use-papers";
import { useCostDrawer } from "@/lib/hooks/use-cost-drawer";
import { useSettings } from "@/lib/hooks/use-settings";
import type { Paper } from "@/lib/types";

export function CostChip({ paper }: { paper: Paper }) {
  const { data: cost } = usePaperCost(
    paper.id,
    paper.run_state !== undefined && paper.status !== "failed"
  );
  const toggleDrawer = useCostDrawer((s) => s.toggle);
  const budgetCap = useSettings((s) => s.defaultBudgetCapUsd);

  const billed = cost?.running_billed_usd ?? 0;
  const projected =
    cost?.estimate_total_raw_usd !== undefined
      ? cost.estimate_total_raw_usd * (cost.markup_factor ?? 1)
      : 0;

  const ratio = budgetCap > 0 ? billed / budgetCap : 0;
  const nearBudget = ratio >= 0.8 && ratio < 1;
  const overBudget = ratio >= 1;

  return (
    <motion.button
      onClick={toggleDrawer}
      layout
      className={cn(
        "group inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium tabular-nums transition-colors",
        !nearBudget && !overBudget &&
          "border-border bg-background text-foreground hover:border-primary/40 hover:bg-accent/40",
        nearBudget &&
          "border-severity-medium/40 bg-severity-medium/10 text-severity-medium hover:bg-severity-medium/15",
        overBudget &&
          "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15"
      )}
      aria-label="Open cost breakdown"
    >
      <CircleDollarSign className="size-3.5" />
      <span>${billed.toFixed(2)}</span>
      {projected > 0 && paper.run_state !== "completed" && paper.status !== "ready" && (
        <>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground">~${projected.toFixed(2)}</span>
        </>
      )}
    </motion.button>
  );
}
