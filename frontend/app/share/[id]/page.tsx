"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, Eye, Lock } from "lucide-react";

import { PdfViewer } from "@/components/workspace/pdf-viewer";
import { FindingPanel } from "@/components/workspace/finding-panel";
import { StatusBadge } from "@/components/papers/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LoupeLockup } from "@/components/brand/loupe-mark";
import { usePaper } from "@/lib/hooks/use-papers";

/**
 * Public read-only view of a paper. Anyone with the URL can see the PDF,
 * findings, your decisions, and investigation threads. No action buttons,
 * no login. Mirrors the live workspace layout so links feel native.
 */
export default function SharedPaperPage({
  params,
}: {
  params: { id: string };
}) {
  const paperQuery = usePaper(params.id);
  const paper = paperQuery.data;
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (paper && !selectedId) setSelectedId(paper.findings[0]?.id ?? null);
  }, [paper, selectedId]);

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-muted/30 px-6">
        <div className="flex min-w-0 items-center gap-4">
          <Link href="/" className="block shrink-0" aria-label="Loupe home">
            <LoupeLockup height={24} />
          </Link>
          <span className="h-5 w-px bg-border" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">
              {paper?.title ?? "Loading…"}
            </h1>
            {paper && (
              <p className="truncate font-mono text-[11px] text-muted-foreground">
                {paper.filename}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-[11px] text-muted-foreground">
            <Eye className="size-3" /> Read-only shared view
          </span>
          {paper && <StatusBadge status={paper.status} />}
        </div>
      </header>

      <section className="flex min-h-0 flex-1 overflow-hidden">
        {paperQuery.isLoading ? (
          <div className="grid flex-1 grid-cols-[1fr_380px]">
            <Skeleton className="m-6 rounded-md" />
            <div className="space-y-3 p-6">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          </div>
        ) : !paper ? (
          <NotFound />
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(420px,460px)]">
            <PdfViewer
              paperId={paper.id}
              paperTitle={paper.title}
              findings={paper.findings}
              selectedFindingId={selectedId}
              segments={paper.segments}
              totalPages={paper.total_pages}
            />
            <FindingPanel
              findings={paper.findings}
              selectedId={selectedId}
              onSelect={setSelectedId}
              // All mutations are no-ops in read-only mode.
              onDecide={async () => {}}
              onInvestigate={async () => {}}
              readOnly
            />
          </div>
        )}
      </section>

      <footer className="flex h-10 shrink-0 items-center justify-between border-t border-border bg-muted/30 px-6 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Lock className="size-3" /> Shared via Loupe — read-only. No login required.
        </span>
        <Link
          href="https://github.com/morphmind/loupe"
          target="_blank"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          Run your own instance <ArrowUpRight className="size-3" />
        </Link>
      </footer>
    </div>
  );
}

function NotFound() {
  return (
    <div className="grid flex-1 place-items-center">
      <div className="text-center">
        <h2 className="text-lg font-semibold">Paper not found</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The link may be broken or the paper was deleted.
        </p>
      </div>
    </div>
  );
}
