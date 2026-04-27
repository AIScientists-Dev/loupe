"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft, ArrowLeft as BackIcon, Link2, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { Workspace } from "@/components/workspace/workspace";
import { ReviewReport } from "@/components/review/review-report";
import { StatusBanner } from "@/components/workspace/status-banner";
import { RunControls } from "@/components/workspace/run-controls";
import { SharePaperDialog } from "@/components/papers/share-paper-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { paperKeys, usePaper, usePaperStatus } from "@/lib/hooks/use-papers";
import { useAnalysisStream } from "@/lib/hooks/use-analysis-stream";
import type { ReviewStage } from "@/lib/types";

/**
 * v3 surface routing:
 *   - uploaded / triaging  → "still triaging" placeholder
 *   - triaged / dived      → ReviewReport (the unified Stage 1/2 report card)
 *   - diving               → Workspace split (live activity stream + PDF)
 *   - User clicks [Adjust] on a dived paper → Workspace split (decisions)
 */
export default function WorkspacePage({
  params,
}: {
  params: { id: string };
}) {
  const qc = useQueryClient();
  const paperQuery = usePaper(params.id);
  const paper = paperQuery.data;
  const [shareOpen, setShareOpen] = React.useState(false);
  // When the user explicitly clicks "Adjust by reviewing findings", the page
  // overrides the default surface and shows the workspace split instead. The
  // pref is local to this paper open — refresh resets it back to the report.
  const [adjustOverride, setAdjustOverride] = React.useState(false);

  const isAnalyzing =
    !!paper && paper.status !== "ready" && paper.status !== "failed";
  const statusQuery = usePaperStatus(params.id, isAnalyzing);
  useAnalysisStream(params.id, isAnalyzing);

  // Cache-drift sync: see comment in v3 plan §3.
  const pollSnapshot = statusQuery.data;
  React.useEffect(() => {
    if (!pollSnapshot || !paper) return;
    const drift =
      paper.status !== pollSnapshot.status ||
      paper.findings.length !== pollSnapshot.finding_count;
    if (!drift) return;
    qc.invalidateQueries({ queryKey: paperKeys.detail(params.id) });
  }, [pollSnapshot, paper, qc, params.id]);
  const polledStatus = statusQuery.data?.status;
  React.useEffect(() => {
    if (paper && polledStatus && polledStatus !== paper.status) {
      paperQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polledStatus]);

  const stage: ReviewStage = (paper?.stage ?? "uploaded") as ReviewStage;
  // Default surface choice. Adjust override beats stage routing.
  const showSplit =
    adjustOverride || stage === "diving";
  const showReport =
    !showSplit && (stage === "triaged" || stage === "dived");
  const showTriagingPlaceholder =
    !showSplit && (stage === "uploaded" || stage === "triaging");

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-3">
          {showSplit && stage === "dived" ? (
            // From the adjust split, "Back" goes back to the report card,
            // not to the library — finishing decisions usually means
            // returning to the report to finalize.
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setAdjustOverride(false)}
              aria-label="Back to report"
            >
              <BackIcon className="size-4" />
            </Button>
          ) : (
            <Button variant="ghost" size="icon-sm" asChild>
              <Link href="/papers" aria-label="Back to papers">
                <ArrowLeft className="size-4" />
              </Link>
            </Button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              {paper ? (paper.title || paper.filename) : "Loading…"}
            </h1>
            {paper && paper.title && (
              <p className="truncate font-mono text-xs text-muted-foreground">
                {paper.filename}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {paper && <StatusBanner paper={paper} />}
          {paper && <RunControls paper={paper} />}
          {paper && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShareOpen(true)}
              className="gap-1.5"
              aria-label="Share paper"
            >
              <Link2 className="size-3.5" /> Share
            </Button>
          )}
        </div>
      </header>

      {paper && (
        <SharePaperDialog
          paper={paper}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}

      <section className="flex min-h-0 flex-1 overflow-hidden">
        {paperQuery.isLoading ? (
          <LoadingState />
        ) : !paper ? (
          <NotFoundState />
        ) : showTriagingPlaceholder ? (
          <TriagingPlaceholder filename={paper.filename} />
        ) : showReport ? (
          <div className="flex min-h-0 flex-1 overflow-y-auto bg-muted/10">
            <ReviewReport
              paper={paper}
              onAdjust={() => setAdjustOverride(true)}
            />
          </div>
        ) : (
          <Workspace paper={paper} />
        )}
      </section>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid flex-1 grid-cols-[1fr_380px]">
      <div className="border-r border-border p-6">
        <Skeleton className="h-full w-full" />
      </div>
      <div className="space-y-3 p-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}

function NotFoundState() {
  return (
    <div className="grid flex-1 place-items-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Paper not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          It may have been deleted.
        </p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/papers">Back to papers</Link>
        </Button>
      </div>
    </div>
  );
}

function TriagingPlaceholder({ filename }: { filename: string }) {
  return (
    <div className="grid flex-1 place-items-center bg-muted/10">
      <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin text-primary" />
        <div>
          <div className="text-sm font-medium text-foreground">
            Triaging {filename}…
          </div>
          <div className="mt-1 text-xs">
            Scope, novelty, fit + quick verdict — usually under a minute.
          </div>
        </div>
      </div>
    </div>
  );
}
