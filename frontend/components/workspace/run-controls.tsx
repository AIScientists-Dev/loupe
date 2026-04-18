"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CircleStop, Play, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useResumePaper, useStopPaper } from "@/lib/hooks/use-papers";
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

  if (paper.run_state === "completed" || paper.status === "ready") {
    return null; // nothing to control
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
