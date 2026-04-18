"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AnalysisProgress } from "@/components/workspace/analysis-progress";
import { Workspace } from "@/components/workspace/workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/papers/status-badge";
import {
  useDeletePaper,
  usePaper,
  usePaperStatus,
} from "@/lib/hooks/use-papers";

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
  const deletePaper = useDeletePaper();

  const polledStatus = statusQuery.data?.status;
  React.useEffect(() => {
    if (paper && polledStatus && polledStatus !== paper.status) {
      paperQuery.refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polledStatus]);

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
        <div className="flex items-center gap-3">
          {paper && <StatusBadge status={paper.status} />}
          {paper && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Delete paper"
              onClick={async () => {
                if (!confirm("Delete this paper? This cannot be undone.")) return;
                try {
                  await deletePaper.mutateAsync(paper.id);
                  toast.success("Paper deleted");
                  router.push("/papers");
                } catch (err) {
                  toast.error("Delete failed", {
                    description: err instanceof Error ? err.message : undefined,
                  });
                }
              }}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </header>

      <section className="flex flex-1 overflow-hidden">
        {paperQuery.isLoading ? (
          <LoadingState />
        ) : !paper ? (
          <NotFoundState />
        ) : paper.status === "ready" ? (
          <Workspace paper={paper} />
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
