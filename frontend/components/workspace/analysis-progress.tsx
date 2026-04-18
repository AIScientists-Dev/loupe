"use client";

import { motion } from "framer-motion";
import { Check, Loader2, CircleDashed, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { InfoTrigger } from "@/components/glossary/info-trigger";
import type { PaperStatusResponse } from "@/lib/types";

type StepDef = { key: "parse" | "extract_proofs" | "verify_proofs"; label: string; detail: string };

const STEPS: StepDef[] = [
  { key: "parse", label: "Parse", detail: "Extracting markdown and page layout." },
  { key: "extract_proofs", label: "Extract proofs", detail: "Locating theorems, lemmas, and proof blocks." },
  { key: "verify_proofs", label: "Verify proofs", detail: "Checking arithmetic, logic, and assumptions." },
];

export function AnalysisProgress({
  status,
  onRetry,
}: {
  status: PaperStatusResponse;
  onRetry?: () => void;
}) {
  const failed = status.status === "failed";
  const activeIndex = failed
    ? Math.max(0, status.step_index)
    : status.status === "ready"
      ? 3
      : status.step_index;

  return (
    <div className="mx-auto grid w-full max-w-2xl place-items-center px-8">
      <div className="flex w-full flex-col items-center gap-10 py-12">
        <div className="text-center">
          <h2 className="inline-flex items-center gap-1.5 text-2xl font-semibold tracking-tight">
            {failed ? "Analysis failed" : "Analyzing your paper"}
            {!failed && (
              <InfoTrigger
                section="pipeline"
                label="About the analysis pipeline"
                size={14}
                className="self-end"
              />
            )}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {failed
              ? status.error?.message ?? "Something went wrong during analysis."
              : "Loupe is reading the paper and surfacing suspicious proof steps. This usually takes 1–2 minutes."}
          </p>
        </div>

        <div className="flex w-full items-center justify-between gap-3">
          {STEPS.map((step, i) => {
            const state: "done" | "active" | "pending" | "error" = failed && i === activeIndex
              ? "error"
              : i < activeIndex
                ? "done"
                : i === activeIndex
                  ? "active"
                  : "pending";
            return (
              <StepNode
                key={step.key}
                index={i}
                step={step}
                state={state}
                isLast={i === STEPS.length - 1}
              />
            );
          })}
        </div>

        {!failed && (
          <motion.div
            key={activeIndex}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-full border border-border bg-muted/40 px-4 py-1.5 text-xs text-muted-foreground"
          >
            <Loader2 className="size-3 animate-spin text-primary" />
            {activeIndex < STEPS.length
              ? STEPS[activeIndex].detail
              : "Finalizing…"}
            {status.finding_count > 0 && (
              <>
                <span className="h-3 w-px bg-border" />
                <span>{status.finding_count} finding{status.finding_count === 1 ? "" : "s"} so far</span>
              </>
            )}
          </motion.div>
        )}

        {failed && (
          <div className="flex flex-col items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              <AlertCircle className="size-3.5" />
              <span className="font-mono">{status.error?.code ?? "internal"}</span>
            </div>
            {status.error?.retriable && onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StepNode({
  step,
  state,
  index,
  isLast,
}: {
  step: StepDef;
  state: "done" | "active" | "pending" | "error";
  index: number;
  isLast: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      <div className="flex w-full items-center">
        <div className={cn("h-px flex-1", index === 0 ? "bg-transparent" : state === "done" || state === "active" ? "bg-primary" : "bg-border")} />
        <motion.div
          initial={false}
          animate={{
            scale: state === "active" ? 1.05 : 1,
          }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className={cn(
            "relative grid size-9 place-items-center rounded-full border-2 transition-colors",
            state === "done" && "border-primary bg-primary text-primary-foreground",
            state === "active" && "border-primary bg-background text-primary",
            state === "pending" && "border-border bg-background text-muted-foreground",
            state === "error" && "border-destructive bg-destructive/10 text-destructive"
          )}
        >
          {state === "done" && <Check className="size-4" />}
          {state === "active" && <Loader2 className="size-4 animate-spin" />}
          {state === "pending" && <CircleDashed className="size-4" />}
          {state === "error" && <AlertCircle className="size-4" />}
          {state === "active" && (
            <span className="absolute inset-0 rounded-full ring-4 ring-primary/15 animate-pulse" />
          )}
        </motion.div>
        <div className={cn("h-px flex-1", isLast ? "bg-transparent" : state === "done" ? "bg-primary" : "bg-border")} />
      </div>
      <div className="text-center">
        <div
          className={cn(
            "text-xs font-medium",
            state === "done" && "text-foreground",
            state === "active" && "text-primary",
            state === "pending" && "text-muted-foreground",
            state === "error" && "text-destructive"
          )}
        >
          {step.label}
        </div>
      </div>
    </div>
  );
}
