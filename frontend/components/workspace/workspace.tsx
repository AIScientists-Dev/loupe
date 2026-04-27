"use client";

import * as React from "react";
import { toast } from "sonner";
import { AnimatePresence, motion } from "framer-motion";
import { ClipboardList, X } from "lucide-react";

import { PdfViewer } from "./pdf-viewer";
import { FindingPanel, type FocusEditSignal } from "./finding-panel";
import { CostDrawer } from "./cost-drawer";
import { ActivityStrip } from "./activity-strip";
import { DimensionPanel } from "./dimension-panel";
import { DraftReviewDialog } from "../review/draft-review-dialog";
import { cn } from "@/lib/utils";
import {
  useDecideFinding,
  useInvestigateFinding,
  usePaperCost,
  usePlaceFinding,
  useSkipSegment,
  useStopPaper,
} from "@/lib/hooks/use-papers";
import { useSettings } from "@/lib/hooks/use-settings";
import { useSettingsDialog } from "@/lib/hooks/use-settings-dialog";
import type { Bbox, Paper } from "@/lib/types";

// Viewports below this collapse the finding panel into a slide-over drawer.
const NARROW_BREAKPOINT = 1024;

// Draggable splitter constraints (in CSS px).
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 720;
const PANEL_DEFAULT_WIDTH = 420;
const PDF_MIN_WIDTH = 420;         // keep the PDF pane legible
const PANEL_WIDTH_STORAGE_KEY = "loupe.panel.width";

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

/** Persisted, clamped panel width with drag support. */
function usePanelWidth(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = React.useState<number>(PANEL_DEFAULT_WIDTH);
  const [dragging, setDragging] = React.useState(false);
  // We only seed from container width once, on first observation. Any saved
  // localStorage value wins — user's drag history is respected.
  const seededRef = React.useRef(false);

  React.useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
      if (saved >= PANEL_MIN_WIDTH && saved <= PANEL_MAX_WIDTH) {
        setWidth(saved);
        seededRef.current = true;
      }
    } catch {}
  }, []);

  // Re-clamp on container resize so panel never pushes PDF below PDF_MIN_WIDTH.
  // Also seed the default to ~1/3 of the container on first observation when
  // the user has no saved width — looks better on wide monitors than 420px.
  React.useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      const avail = root.clientWidth;
      if (!seededRef.current && avail > 0) {
        seededRef.current = true;
        const target = Math.round(avail / 3);
        const clamped = Math.max(
          PANEL_MIN_WIDTH,
          Math.min(PANEL_MAX_WIDTH, Math.min(target, avail - PDF_MIN_WIDTH))
        );
        setWidth(clamped);
        return;
      }
      setWidth((w) => Math.min(w, Math.max(PANEL_MIN_WIDTH, avail - PDF_MIN_WIDTH)));
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [containerRef]);

  const startDrag = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(true);
      const root = containerRef.current;
      if (!root) return;
      const onMove = (ev: MouseEvent) => {
        const rootRect = root.getBoundingClientRect();
        const next = rootRect.right - ev.clientX;
        const avail = rootRect.width;
        const clamped = Math.max(
          PANEL_MIN_WIDTH,
          Math.min(PANEL_MAX_WIDTH, Math.min(next, avail - PDF_MIN_WIDTH))
        );
        setWidth(clamped);
      };
      const onUp = () => {
        setDragging(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        try {
          // read latest width from state via a setter trick
          setWidth((w) => {
            try {
              localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(w));
            } catch {}
            return w;
          });
        } catch {}
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [containerRef]
  );

  return { width, dragging, startDrag };
}

export function Workspace({ paper }: { paper: Paper }) {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    paper.findings[0]?.id ?? null
  );
  const [reviewOpen, setReviewOpen] = React.useState(false);
  const [reviewInitialDraftId, setReviewInitialDraftId] = React.useState<string | undefined>(undefined);
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
  const place = usePlaceFinding(paper.id);
  const skip = useSkipSegment(paper.id);
  const stop = useStopPaper();

  // Manual-placement mode target. null → off; findingId → crosshair active.
  const [placementTarget, setPlacementTarget] = React.useState<
    { findingId: string } | null
  >(null);
  const startPlacement = React.useCallback((findingId: string) => {
    setPlacementTarget({ findingId });
  }, []);
  const cancelPlacement = React.useCallback(() => setPlacementTarget(null), []);
  const commitPlacement = React.useCallback(
    async (findingId: string, page: number, bbox: Bbox) => {
      try {
        await place.mutateAsync({ findingId, page, bbox });
        toast.success("Box placed");
      } catch (err) {
        toast.error("Could not save placement", {
          description: err instanceof Error ? err.message : undefined,
        });
      } finally {
        setPlacementTarget(null);
      }
    },
    [place]
  );
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

  // v2: when the deep dive has populated dimension scores, show the radar +
  // per-dimension chips above the findings list. Hidden during stage=triaged
  // (paper handled by TriageCard upstream) and stage=diving (no scores yet).
  const showDimensions = !!paper.dimension_scores && paper.dimension_scores.length > 0;

  const findingPanel = (
    <div className="flex h-full w-full flex-col overflow-hidden">
      {showDimensions && <DimensionPanel paper={paper} />}
      <div className="min-h-0 flex-1">
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
          onRequestPlacement={(id) => {
            startPlacement(id);
            setSelectedId(id);
            if (isNarrow) setPanelOpen(false);
          }}
          paperId={paper.id}
          onGenerateReview={(draftId) => {
            setReviewInitialDraftId(draftId);
            setReviewOpen(true);
          }}
        />
      </div>
    </div>
  );

  const splitContainerRef = React.useRef<HTMLDivElement | null>(null);
  const { width: panelWidth, dragging: splitterDragging, startDrag: onSplitterDown } =
    usePanelWidth(splitContainerRef);

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
      {/* v3: triage banner removed — the parent page renders the unified
          ReviewReport as the default surface. The workspace is now purely
          the "Adjust mode" decision split. */}
      <div
        ref={splitContainerRef}
        className={cn(
          "relative flex min-h-0 w-full flex-1 overflow-hidden",
          // On narrow viewports the panel becomes a drawer; layout is flex-col
          // so the PDF fills the width and drawer floats over it.
          isNarrow && "flex-col",
          splitterDragging && "select-none"
        )}
      >
        <div className="min-h-0 min-w-0 flex-1">
          <PdfViewer
            paperId={paper.id}
            paperTitle={paper.title}
            findings={paper.findings}
            selectedFindingId={selectedId}
            segments={paper.segments}
            totalPages={paper.total_pages}
            onSkipSegment={handleSkip}
            onReopenFinding={handleReopen}
            placementTarget={placementTarget}
            onPlaceFinding={commitPlacement}
            onPlacementCancel={cancelPlacement}
            onSelectFinding={(id) => {
              setSelectedId(id);
              if (isNarrow) setPanelOpen(true);
            }}
            onReplacePlacement={(id) => {
              setSelectedId(id);
              startPlacement(id);
            }}
          />
        </div>

        {/* Desktop: draggable splitter + inline panel at the user's chosen width. */}
        {!isNarrow && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize finding panel"
              onMouseDown={onSplitterDown}
              className={cn(
                "group relative z-10 flex w-1 shrink-0 cursor-col-resize items-center justify-center bg-border transition-colors hover:bg-primary/40",
                splitterDragging && "bg-primary/60"
              )}
            >
              {/* Visual affordance: a small grip appears on hover */}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full opacity-0 transition-opacity group-hover:opacity-100",
                  splitterDragging && "opacity-100"
                )}
              />
            </div>
            <div
              className="min-h-0 shrink-0"
              style={{ width: panelWidth }}
            >
              {findingPanel}
            </div>
          </>
        )}

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
          onOpenChange={(v) => {
            setReviewOpen(v);
            if (!v) setReviewInitialDraftId(undefined);
          }}
          initialDraftId={reviewInitialDraftId}
        />
      </div>
      <ActivityStrip paper={paper} />
      <CostDrawer paper={paper} />
    </div>
  );
}
