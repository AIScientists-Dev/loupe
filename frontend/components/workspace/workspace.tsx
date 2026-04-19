"use client";

import * as React from "react";
import { toast } from "sonner";

import { PdfViewer } from "./pdf-viewer";
import { FindingPanel } from "./finding-panel";
import { CostDrawer } from "./cost-drawer";
import { DraftReviewDialog } from "../review/draft-review-dialog";
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

export function Workspace({ paper }: { paper: Paper }) {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    paper.findings[0]?.id ?? null
  );
  const [reviewOpen, setReviewOpen] = React.useState(false);

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

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden">
      <div className="grid min-h-0 w-full flex-1 grid-cols-[minmax(0,1fr)_minmax(420px,460px)] overflow-hidden">
      <PdfViewer
        paperTitle={paper.title}
        findings={paper.findings}
        selectedFindingId={selectedId}
        segments={paper.segments}
        totalPages={paper.total_pages}
        onSkipSegment={handleSkip}
      />
      <FindingPanel
        findings={paper.findings}
        selectedId={selectedId}
        onSelect={(id) => setSelectedId(id)}
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
