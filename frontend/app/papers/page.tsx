"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import {
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PaperGrid } from "@/components/papers/paper-grid";
import { PaperGridSkeleton } from "@/components/papers/paper-grid-skeleton";
import { UploadDialog } from "@/components/papers/upload-dialog";
import { BatchActionBar } from "@/components/papers/batch-action-bar";
import { OnboardingDialog } from "@/components/onboarding/onboarding-dialog";
import { cn } from "@/lib/utils";
import { usePaperList } from "@/lib/hooks/use-papers";
import { useOnboarding } from "@/lib/hooks/use-onboarding";
import {
  STATUS_FOLDERS,
  filterPapers,
  type StatusFolderKey,
} from "@/lib/hooks/use-folders";

const STATUS_LABEL = Object.fromEntries(
  STATUS_FOLDERS.map((s) => [s.key, s.label] as const),
) as Record<StatusFolderKey, string>;

type FlagFilter = "promising" | "rejected" | null;

export default function PapersPage() {
  const search = useSearchParams();
  const { data: papers, isLoading } = usePaperList();
  const onboarded = useOnboarding((s) => !!s.profile);

  const status = (search.get("status") as StatusFolderKey | null) ?? null;
  const folderParam = search.get("folder") ?? null;
  const venue = folderParam === "__unfiled" ? null : folderParam;
  const isUnfiled = folderParam === "__unfiled";

  // v3: Promising/Rejected become *flag chips* on this page (not folders).
  // They AND with the active folder/status filter.
  const [flagFilter, setFlagFilter] = React.useState<FlagFilter>(null);

  const visiblePapers = React.useMemo(() => {
    if (!papers) return [];
    let list = papers;
    if (status) list = filterPapers(list, { status });
    else if (isUnfiled) list = list.filter((p) => !p.folder);
    else if (venue) list = filterPapers(list, { venue });
    if (flagFilter) list = list.filter((p) => (p.flag ?? null) === flagFilter);
    return list;
  }, [papers, status, venue, isUnfiled, flagFilter]);

  // Flag counts honour the current folder/status scope so the chip badges
  // stay relevant: "3 promising in JASA" vs "5 promising overall".
  const flagCounts = React.useMemo(() => {
    if (!papers) return { promising: 0, rejected: 0 };
    let scope = papers;
    if (status) scope = filterPapers(scope, { status });
    else if (isUnfiled) scope = scope.filter((p) => !p.folder);
    else if (venue) scope = filterPapers(scope, { venue });
    let p = 0;
    let r = 0;
    for (const x of scope) {
      if (x.flag === "promising") p += 1;
      if (x.flag === "rejected") r += 1;
    }
    return { promising: p, rejected: r };
  }, [papers, status, venue, isUnfiled]);

  const title = status
    ? STATUS_LABEL[status]
    : isUnfiled
      ? "Unfiled"
      : (venue ?? "All papers");
  const subtitle = status
    ? STATUS_FOLDERS.find((s) => s.key === status)?.hint
    : isUnfiled
      ? "Papers not assigned to a venue folder"
      : venue
        ? `Papers in ${venue}`
        : "Review drafts, see findings, compose feedback.";

  const hasPapers = !!papers && papers.length > 0;

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-8">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <BatchActionBar papers={visiblePapers} />
          <UploadDialog defaultFolder={venue ?? undefined} />
        </div>
      </header>

      {/* v3: flag chip row — Promising / Rejected toggles, AND with the
          active folder/status scope. Hidden when zero counts in scope. */}
      {hasPapers && (flagCounts.promising > 0 || flagCounts.rejected > 0) && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-8 py-2">
          <FlagChip
            tone="promising"
            label="Promising"
            count={flagCounts.promising}
            active={flagFilter === "promising"}
            onClick={() =>
              setFlagFilter((f) => (f === "promising" ? null : "promising"))
            }
          />
          <FlagChip
            tone="rejected"
            label="Rejected"
            count={flagCounts.rejected}
            active={flagFilter === "rejected"}
            onClick={() =>
              setFlagFilter((f) => (f === "rejected" ? null : "rejected"))
            }
          />
          {flagFilter && (
            <button
              type="button"
              onClick={() => setFlagFilter(null)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
            >
              Clear filter
            </button>
          )}
        </div>
      )}

      <section className="flex-1 overflow-y-auto px-8 py-6">
        {isLoading ? (
          <PaperGridSkeleton />
        ) : !hasPapers ? (
          <EmptyState />
        ) : visiblePapers.length === 0 ? (
          <EmptyFilter title={title} flagFilter={flagFilter} />
        ) : (
          <PaperGrid papers={visiblePapers} />
        )}
      </section>

      {/* First-visit onboarding gate. Shown until the user completes it. */}
      {!onboarded && <OnboardingDialog />}
    </div>
  );
}

function FlagChip({
  tone,
  label,
  count,
  active,
  onClick,
}: {
  tone: "promising" | "rejected";
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = tone === "promising" ? ThumbsUp : ThumbsDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? tone === "promising"
            ? "border-primary bg-primary text-primary-foreground"
            : "border-destructive bg-destructive text-destructive-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {label}
      <span
        className={cn(
          "ml-1 rounded-full px-1.5 text-[10px] tabular-nums",
          active
            ? "bg-white/15 text-current"
            : "bg-muted-foreground/15 text-muted-foreground",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function EmptyFilter({
  title,
  flagFilter,
}: {
  title: string;
  flagFilter: FlagFilter;
}) {
  return (
    <div className="grid h-full place-items-center">
      <div className="text-center text-sm text-muted-foreground">
        No papers in <span className="font-medium text-foreground">{title}</span>
        {flagFilter && (
          <>
            {" "}
            with <span className="font-medium text-foreground">{flagFilter}</span> flag
          </>
        )}
        .
      </div>
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
          Upload a PDF to start. Loupe triages it in ~1 min and gives you a
          high/medium/low verdict before any deep work runs.
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
