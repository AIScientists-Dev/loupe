"use client";

import * as React from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { ClipboardList, X } from "lucide-react";

import { PdfViewer } from "./pdf-viewer";
import { FindingPanel, type FocusEditSignal } from "./finding-panel";
import { CostDrawer } from "./cost-drawer";
import { DraftReviewDialog } from "../review/draft-review-dialog";
import { cn } from "@/lib/utils";
import {
  useDecideFinding,
  useInvestigateFinding,
  usePaperCost,
  useSkipSegment,
  useStopPaper,
} from "@/lib/hooks/use-papers";
import { useSettings } from "@/lib/hooks/use-settings";
import { useSettingsDialog } from "@/lib/hooks/use-settings-dialog";
import type { Paper } from "@/lib/types";

// Viewports below this collapse the finding panel into a slide-over drawer.
const NARROW_BREAKPOINT = 1024;

function useIsNarrow() {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT - 1}px)`);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return narrow;
}

export function Workspace({ paper }: { paper: Paper }) {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    paper.findings[0]?.id ?? null
  );
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [focusEdit, setFocusEdit] = React.useState<FocusEditSignal | undefined>();
  const isNarrow = useIsNarrow();
  // On narrow viewports the panel starts closed; a floating FAB opens it.
  const [panelOpen, setPanelOpen] = React.useState(false);

  const handleReopen = React.useCallback(
    (id: string) => {
      const f = paper.findings.find((x) => x.id === id);
      if (!f?.decision) return;
      setFocusEdit({ id, decision: f.decision, v: Date.now() });
      if (isNarrow) setPanelOpen(true);
    },
    [paper.findings, isNarrow]
  );

  const decide = useDecideFinding(paper.id);
  const investigate = useInvestigateFinding(paper.id);
  const skip = useSkipSegment(paper.id);
  const stop = useStopPaper();
  const budgetCap = useSettings((s) => s.defaultBudgetCapUsd);
  const openSettings = useSettingsDialog((s) => s.openDialog);
  const { data: cost } = usePaperCost(paper.id, true);

  // Budget guardrail: auto-stop if running billed cost exceeds the user's cap.
  const billed = cost?.running_billed_usd ?? 0;
  const budgetExceeded =
    budgetCap > 0 &&
    billed > budgetCap &&
    paper.run_state === "running";
  const budgetToastedRef = React.useRef(false);
  React.useEffect(() => {
    if (!budgetExceeded || budgetToastedRef.current) return;
    budgetToastedRef.current = true;
    (async () => {
      try {
        await stop.mutateAsync(paper.id);
      } catch {}
      toast.error(
        `Budget cap of $${budgetCap.toFixed(2)} reached — analysis stopped`,
        {
          description:
            "Raise the cap in Settings, or accept the partial result.",
          duration: 10_000,
          action: {
            label: "Open Settings",
            onClick: () => openSettings(),
          },
        }
      );
    })();
  }, [budgetExceeded, budgetCap, paper.id, stop]);

  const handleSkip = async (segmentId: string) => {
    try {
      await skip.mutateAsync(segmentId);
      toast.success("Range skipped");
    } catch (err) {
      toast.error("Could not skip", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const openCount = paper.findings.filter((f) => !f.decision).length;

  const findingPanel = (
    <FindingPanel
      findings={paper.findings}
      selectedId={selectedId}
      onSelect={(id) => setSelectedId(id)}
      focusEdit={focusEdit}
      onClose={isNarrow ? () => setPanelOpen(false) : undefined}
      onDecide={async (id, verdict, note) => {
        try {
          await decide.mutateAsync({ findingId: id, decision: verdict, note });
          toast.success(verdict === "agree" ? "Agreed" : "Dismissed", {
            description: note ? `Note: ${note}` : undefined,
          });
        } catch (err) {
          toast.error("Could not save decision", {
            description: err instanceof Error ? err.message : undefined,
          });
        }
      }}
      onInvestigate={async (id, msg) => {
        try {
          await investigate.mutateAsync({ findingId: id, message: msg });
        } catch (err) {
          toast.error("Investigation failed", {
            description: err instanceof Error ? err.message : undefined,
          });
        }
      }}
      onGenerateReview={() => setReviewOpen(true)}
    />
  );

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
      <div
        className={cn(
          "relative grid min-h-0 w-full flex-1 grid-rows-[minmax(0,1fr)] overflow-hidden",
          // Desktop: 2-col grid with PDF + inline panel.
          // Narrow: single column; panel is a fixed-position slide-over below.
          "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(380px,440px)]"
        )}
      >
        <PdfViewer
          paperId={paper.id}
          paperTitle={paper.title}
          findings={paper.findings}
          selectedFindingId={selectedId}
          segments={paper.segments}
          totalPages={paper.total_pages}
          onSkipSegment={handleSkip}
          onReopenFinding={handleReopen}
        />

        {/* Desktop: inline panel (always visible). */}
        <div className="hidden min-h-0 lg:block">{findingPanel}</div>

        {/* Narrow viewport: slide-over drawer. */}
        {isNarrow && (
          <>
            <AnimatePresence>
              {panelOpen && (
                <motion.div
                  key="backdrop"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="fixed inset-0 z-40 bg-black/40"
                  onClick={() => setPanelOpen(false)}
                  aria-hidden
                />
              )}
            </AnimatePresence>
            <AnimatePresence>
              {panelOpen && (
                <motion.aside
                  key="drawer"
                  initial={{ x: "100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "100%" }}
                  transition={{ type: "tween", duration: 0.22, ease: "easeOut" }}
                  className="fixed inset-y-0 right-0 z-50 flex w-[min(420px,92vw)] flex-col bg-background shadow-2xl"
                  role="dialog"
                  aria-label="Findings"
                >
                  {findingPanel}
                </motion.aside>
              )}
            </AnimatePresence>

            {!panelOpen && (
              <button
                type="button"
                onClick={() => setPanelOpen(true)}
                className="fixed bottom-20 right-4 z-30 inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2.5 text-sm font-medium shadow-lg transition-colors hover:bg-muted"
                aria-label={`Open findings panel (${openCount} open)`}
              >
                <ClipboardList className="size-4" />
                Findings
                {openCount > 0 && (
                  <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                    {openCount}
                  </span>
                )}
              </button>
            )}
          </>
        )}

        <DraftReviewDialog
          paper={paper}
          open={reviewOpen}
          onOpenChange={setReviewOpen}
        />
      </div>
      <CostDrawer paper={paper} />
    </div>
  );
}
