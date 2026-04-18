"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { FileText, ArrowUpRight } from "lucide-react";

import { StatusBadge } from "./status-badge";
import type { PaperSummary } from "@/lib/types";

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
      className="group relative flex flex-col gap-3 rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40 hover:bg-accent/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <FileText className="size-4" />
        </div>
        <StatusBadge status={paper.status} />
      </div>

      <div className="min-h-0 flex-1">
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug tracking-tight">
          {paper.title}
        </h3>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {paper.filename}
        </p>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{subtitle}</span>
        <span>
          {formatDistanceToNow(new Date(paper.created_at), { addSuffix: true })}
        </span>
      </div>

      <ArrowUpRight className="absolute right-5 top-5 size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}
