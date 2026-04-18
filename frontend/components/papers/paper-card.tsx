"use client";

import * as React from "react";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, FileText, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "./status-badge";
import { cn } from "@/lib/utils";
import { useDeletePaper } from "@/lib/hooks/use-papers";
import type { PaperSummary } from "@/lib/types";

export function PaperCard({ paper }: { paper: PaperSummary }) {
  const del = useDeletePaper();

  const subtitle =
    paper.status === "ready"
      ? `${paper.finding_count} finding${paper.finding_count === 1 ? "" : "s"} · ${paper.decided_count} decided`
      : paper.status === "failed"
        ? "Analysis failed"
        : "Analyzing…";

  const onDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${paper.title}"? This cannot be undone.`)) return;
    try {
      await del.mutateAsync(paper.id);
      toast.success("Paper deleted");
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <Link
      href={`/papers/${paper.id}`}
      className={cn(
        "group relative flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-all",
        "hover:border-primary/50 hover:shadow-md hover:-translate-y-0.5",
        del.isPending && "pointer-events-none opacity-60"
      )}
    >
      {/* Top row: status pill left, hover actions right */}
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={paper.status} />
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={onDelete}
            aria-label="Delete paper"
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            {del.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </button>
          <span className="grid size-7 place-items-center text-muted-foreground">
            <ArrowUpRight className="size-4" />
          </span>
        </div>
      </div>

      {/* Title block */}
      <div className="flex min-h-[4.5rem] flex-col gap-1.5">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight text-foreground">
          {paper.title}
        </h3>
        <p className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground">
          <FileText className="size-3 shrink-0 text-muted-foreground/60" />
          <span className="truncate">{paper.filename}</span>
        </p>
      </div>

      {/* Footer row: meta + time */}
      <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
        <span className="truncate">{subtitle}</span>
        <span className="shrink-0 whitespace-nowrap">
          {formatDistanceToNow(new Date(paper.created_at), { addSuffix: true })}
        </span>
      </div>
    </Link>
  );
}
