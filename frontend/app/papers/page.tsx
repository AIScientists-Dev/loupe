"use client";

import { Upload, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PaperGrid } from "@/components/papers/paper-grid";
import { PaperGridSkeleton } from "@/components/papers/paper-grid-skeleton";
import { UploadDialog } from "@/components/papers/upload-dialog";
import { usePaperList } from "@/lib/hooks/use-papers";

export default function PapersPage() {
  const { data: papers, isLoading } = usePaperList();
  const hasPapers = !!papers && papers.length > 0;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Papers</h1>
          <p className="text-xs text-muted-foreground">
            Review drafts, see findings, compose feedback.
          </p>
        </div>
        <UploadDialog />
      </header>

      <section className="flex-1 overflow-y-auto px-8 py-6">
        {isLoading ? (
          <PaperGridSkeleton />
        ) : hasPapers ? (
          <PaperGrid papers={papers!} />
        ) : (
          <EmptyState />
        )}
      </section>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex max-w-md flex-col items-center text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/decor/empty-state-decor.svg"
          alt=""
          className="mb-3 h-64 w-auto select-none"
        />
        <h2 className="text-xl font-semibold tracking-tight">No papers yet</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Upload a PDF to start. Loupe parses it, extracts theorems and proofs,
          and surfaces suspicious steps for your review — usually in under two
          minutes.
        </p>
        <UploadDialog
          trigger={
            <Button size="lg" className="mt-6">
              <Upload className="size-4" /> Upload your first paper
            </Button>
          }
        />
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Sparkles className="size-3" /> Works best with typeset math and
          statistics papers.
        </p>
      </div>
    </div>
  );
}
