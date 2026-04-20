"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Link2, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Workspace } from "@/components/workspace/workspace";
import { StatusBanner } from "@/components/workspace/status-banner";
import { RunControls } from "@/components/workspace/run-controls";
import { SharePaperDialog } from "@/components/papers/share-paper-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  usePaper,
  usePaperStatus,
  useResumePaper,
  useStopPaper,
} from "@/lib/hooks/use-papers";
import { useAnalysisStream } from "@/lib/hooks/use-analysis-stream";
import { useHotkeys } from "@/lib/hooks/use-hotkeys";
import { useCostDrawer } from "@/lib/hooks/use-cost-drawer";

export default function WorkspacePage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const paperQuery = usePaper(params.id);
  const paper = paperQuery.data;
  const [shareOpen, setShareOpen] = React.useState(false);
  const isAnalyzing =
    !!paper && paper.status !== "ready" && paper.status !== "failed";
  const statusQuery = usePaperStatus(params.id, isAnalyzing);
  useAnalysisStream(params.id, isAnalyzing);
  const stop = useStopPaper();
  const resume = useResumePaper();
  const toggleCostDrawer = useCostDrawer((s) => s.toggle);

  // Workspace-level hotkeys. 's' toggles Stop/Resume based on current run state.
  useHotkeys(
    [
      {
        keys: ["s"],
        handler: async (e) => {
          if (!paper) return;
          e.preventDefault();
          if (paper.run_state === "running") {
            try {
              await stop.mutateAsync(paper.id);
              toast.success("Analysis stopped");
            } catch {}
          } else if (
            paper.run_state === "stopped" ||
            paper.run_state === "paused"
          ) {
            try {
              await resume.mutateAsync(paper.id);
              toast.success("Analysis resumed");
            } catch {}
          }
        },
      },
      {
        keys: ["c"],
        handler: (e) => {
          e.preventDefault();
          toggleCostDrawer();
        },
      },
    ],
    !!paper
  );

  const polledStatus = statusQuery.data?.status;
  React.useEffect(() => {
    if (paper && polledStatus && polledStatus !== paper.status) {
      paperQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polledStatus]);

  const hasOutline = !!paper?.segments && paper.segments.length > 0;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/papers" aria-label="Back to papers">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              {paper?.title ?? "Loading…"}
            </h1>
            {paper && (
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
        ) : !hasOutline && paper.run_state === "running" ? (
          <PreOutlineSplash />
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

function PreOutlineSplash() {
  return (
    <div className="grid flex-1 place-items-center">
      <div className="flex flex-col items-center gap-2 text-muted-foreground">
        <Loader2 className="size-5 animate-spin text-primary" />
        <p className="text-sm">Reading outline…</p>
        <p className="text-[11px]">Usually takes ~2 seconds.</p>
      </div>
    </div>
  );
}
