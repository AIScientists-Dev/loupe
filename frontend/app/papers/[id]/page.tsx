"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AnalysisProgress } from "@/components/workspace/analysis-progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { usePaper, usePaperStatus } from "@/lib/hooks/use-papers";

export default function WorkspacePage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const paperQuery = usePaper(params.id);
  const paper = paperQuery.data;
  const isAnalyzing =
    !!paper && paper.status !== "ready" && paper.status !== "failed";
  const statusQuery = usePaperStatus(params.id, isAnalyzing);

  // When the pipeline flips to ready, refetch the full paper so findings land.
  const polledStatus = statusQuery.data?.status;
  React.useEffect(() => {
    if (paper && polledStatus && polledStatus !== paper.status) {
      paperQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polledStatus]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8">
        <div className="flex items-center gap-3 min-w-0">
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
      </header>

      <section className="flex flex-1 overflow-hidden">
        {paperQuery.isLoading ? (
          <LoadingState />
        ) : !paper ? (
          <NotFoundState />
        ) : paper.status === "ready" ? (
          <WorkspaceStub findingCount={paper.findings.length} />
        ) : (
          <div className="grid flex-1 place-items-center">
            <AnalysisProgress
              status={
                statusQuery.data ?? {
                  status: paper.status,
                  step: "parse",
                  step_index: 0,
                  total_steps: 3,
                  finding_count: 0,
                  localize_pending: 0,
                }
              }
              onRetry={() => router.refresh()}
            />
          </div>
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

function WorkspaceStub({ findingCount }: { findingCount: number }) {
  return (
    <div className="grid flex-1 place-items-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Analysis complete</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Loupe found {findingCount} suspicious step{findingCount === 1 ? "" : "s"}.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          Workspace (PDF viewer + findings panel) lands in Hour 3.
        </p>
      </div>
    </div>
  );
}
