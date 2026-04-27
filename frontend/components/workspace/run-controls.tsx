"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CircleStop, Play, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  usePaperCost,
  useReanalyzePaper,
  useResumePaper,
  useStopPaper,
} from "@/lib/hooks/use-papers";
import type { Paper } from "@/lib/types";

/**
 * Gmail-style inline-undo Stop button, plus Resume after a stop.
 *
 * Click Stop → button morphs to "Stopping · Undo (3s)" with a shrinking
 * progress underline. 3-second window. After that, the stop actually
 * fires. During the window, clicking anywhere on the button cancels.
 */
export function RunControls({ paper }: { paper: Paper }) {
  const stopMut = useStopPaper();
  const resumeMut = useResumePaper();

  const [pendingStop, setPendingStop] = React.useState<{
    deadline: number;
    remaining: number;
  } | null>(null);

  // Countdown tick + final fire
  React.useEffect(() => {
    if (!pendingStop) return;
    const t = window.setInterval(() => {
      setPendingStop((prev) => {
        if (!prev) return prev;
        const remaining = Math.max(0, prev.deadline - Date.now());
        if (remaining === 0) {
          window.clearInterval(t);
          (async () => {
            try {
              await stopMut.mutateAsync(paper.id);
              toast.success("Analysis stopped", {
                description:
                  "Resume any time — progress is saved. Findings stay interactive.",
              });
            } catch (err) {
              toast.error("Could not stop", {
                description: err instanceof Error ? err.message : undefined,
              });
            }
          })();
          return null;
        }
        return { ...prev, remaining };
      });
    }, 100);
    return () => window.clearInterval(t);
  }, [pendingStop, paper.id, stopMut]);

  const running = paper.run_state === "running";
  const stoppable = running && !pendingStop;
  const isStopping = !!pendingStop;

  const onStop = () => {
    setPendingStop({ deadline: Date.now() + 3000, remaining: 3000 });
  };

  const onUndo = () => {
    setPendingStop(null);
    toast.info("Stop cancelled — analysis continues");
  };

  const onResume = async () => {
    try {
      await resumeMut.mutateAsync(paper.id);
      toast.success("Analysis resumed");
    } catch (err) {
      toast.error("Could not resume", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const scanDone = paper.run_state === "completed" || paper.status === "ready";
  if (scanDone) {
    return <ReanalyzeButton paper={paper} />;
  }

  return (
    <div className="flex items-center gap-2">
      <AnimatePresence mode="popLayout" initial={false}>
        {stoppable && (
          <motion.div
            key="stop"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
          >
            <Button
              size="sm"
              variant="outline"
              onClick={onStop}
              disabled={stopMut.isPending}
              className="gap-1.5"
            >
              <CircleStop className="size-3.5" />
              Stop
            </Button>
          </motion.div>
        )}

        {isStopping && pendingStop && (
          <motion.button
            key="undo"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            onClick={onUndo}
            className={cn(
              "relative inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-md border border-severity-medium/40 bg-severity-medium/10 px-3 text-xs font-medium text-severity-medium transition-colors hover:bg-severity-medium/15"
            )}
            aria-label="Undo stop"
          >
            <Loader2 className="size-3.5 animate-spin" />
            Stopping · Undo ({Math.ceil(pendingStop.remaining / 1000)}s)
            <span
              aria-hidden
              className="absolute bottom-0 left-0 h-[2px] bg-severity-medium/70"
              style={{ width: `${(pendingStop.remaining / 3000) * 100}%` }}
            />
          </motion.button>
        )}

        {(paper.run_state === "stopped" || paper.run_state === "paused") && (
          <motion.div
            key="resume"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
          >
            <Button
              size="sm"
              onClick={onResume}
              disabled={resumeMut.isPending}
              className="gap-1.5"
            >
              <Play className="size-3.5" />
              Resume
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Button shown when a scan is complete. Opens a confirm dialog quoting the
 * estimated cost (last run's billed total) before firing the re-analyze.
 * Re-analyze re-verifies existing proof_blocks — no re-parse, no re-extract.
 * Existing findings and drafts are preserved; new findings append.
 */
function ReanalyzeButton({ paper }: { paper: Paper }) {
  const [open, setOpen] = React.useState(false);
  const reanalyze = useReanalyzePaper();
  const { data: cost } = usePaperCost(paper.id, true);
  const lastBilled = cost?.running_billed_usd ?? 0;

  const onConfirm = async () => {
    try {
      await reanalyze.mutateAsync(paper.id);
      setOpen(false);
      toast.success("Re-analysis started", {
        description: "New findings will stream in as they're surfaced.",
      });
    } catch (err) {
      toast.error("Could not start re-analysis", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const proofBlockCount = paper.segments
    ? paper.segments.reduce((n, s) => n + (s.proof_block_ids?.length ?? 0), 0)
    : 0;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen(true)}
        className="gap-1.5"
        title="Re-verify previously-analyzed ranges. Existing findings are kept; new ones append."
      >
        <RotateCcw className="size-3.5" />
        Re-analyze
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Re-analyze paper?</DialogTitle>
            <DialogDescription>
              Re-verifies all {proofBlockCount || "—"} proof blocks with the
              latest verifier. Existing findings and drafts are kept; new
              findings will be appended.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Est. cost for this re-analysis
              </span>
              <span className="font-medium tabular-nums text-foreground">
                ${Math.max(lastBilled * 0.5, 0.05).toFixed(2)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-muted-foreground">
                Running total so far
              </span>
              <span className="tabular-nums text-foreground">
                ${lastBilled.toFixed(2)}
              </span>
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground/80">
              Rough estimate — re-verify only (no re-parse).
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              disabled={reanalyze.isPending || proofBlockCount === 0}
              className="gap-1.5"
            >
              {reanalyze.isPending && (
                <Loader2 className="size-3.5 animate-spin" />
              )}
              Re-analyze
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
