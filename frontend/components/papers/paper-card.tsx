"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { ArrowUpRight, FileText } from "lucide-react";

import { StatusBadge } from "./status-badge";
import type { PaperSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PaperCard({ paper }: { paper: PaperSummary }) {
  const subtitle =
    paper.status === "ready"
      ? `${paper.finding_count} finding${paper.finding_count === 1 ? "" : "s"} · ${paper.decided_count} decided`
      : paper.status === "failed"
        ? "Analysis failed"
        : "Analyzing…";

  return (
    <Link
      href={`/papers/${paper.id}`}
      className={cn(
        "group relative flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-all",
        "hover:border-primary/50 hover:shadow-md hover:-translate-y-0.5"
      )}
    >
      {/* Top row: status pill only */}
      <div className="flex items-center justify-between gap-2">
        <StatusBadge status={paper.status} />
        <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
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
