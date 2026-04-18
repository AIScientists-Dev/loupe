"use client";

import * as React from "react";
import { AnimatePresence } from "framer-motion";
import { Eye, EyeOff, SortAsc } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { FindingCard } from "./finding-card";
import type { Finding } from "@/lib/types";

type FilterKey = "open" | "agreed" | "dismissed";
type SortKey = "severity" | "page" | "confidence";

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export function FindingPanel({
  findings,
  selectedId,
  onSelect,
  onDecide,
  onInvestigate,
  onReopen,
  onGenerateReview,
}: {
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDecide: (id: string, verdict: "agree" | "dismiss", note?: string) => Promise<void>;
  onInvestigate: (id: string, message: string) => Promise<void>;
  onReopen: (id: string) => Promise<void>;
  onGenerateReview?: () => void;
}) {
  const [filter, setFilter] = React.useState<FilterKey>("open");
  const [sort, setSort] = React.useState<SortKey>("severity");
  const [showDismissed, setShowDismissed] = React.useState(false);

  const counts = React.useMemo(() => {
    const c = { open: 0, agreed: 0, dismissed: 0 };
    for (const f of findings) {
      if (f.decision === "agree") c.agreed++;
      else if (f.decision === "dismiss") c.dismissed++;
      else c.open++;
    }
    return c;
  }, [findings]);

  const visible = React.useMemo(() => {
    let list = findings.filter((f) => {
      if (filter === "open") return !f.decision;
      if (filter === "agreed") return f.decision === "agree";
      if (filter === "dismissed") return f.decision === "dismiss";
      return true;
    });
    if (filter !== "dismissed" && !showDismissed) {
      list = list.filter((f) => f.decision !== "dismiss");
    }
    list.sort((a, b) => {
      if (sort === "severity")
        return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sort === "page") return (a.bbox_page ?? 0) - (b.bbox_page ?? 0);
      if (sort === "confidence") return b.confidence - a.confidence;
      return 0;
    });
    return list;
  }, [findings, filter, sort, showDismissed]);

  const allDecided = counts.open === 0 && findings.length > 0;

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
          <TabsList>
            <TabsTrigger value="open">
              Open <CountPill n={counts.open} />
            </TabsTrigger>
            <TabsTrigger value="agreed">
              Agreed <CountPill n={counts.agreed} />
            </TabsTrigger>
            <TabsTrigger value="dismissed">
              Dismissed <CountPill n={counts.dismissed} />
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-1">
          <SortDropdown value={sort} onChange={setSort} />
        </div>
      </div>

      <div className="flex-1 space-y-2.5 overflow-y-auto p-4">
        {visible.length === 0 ? (
          <EmptyFilter filter={filter} />
        ) : (
          <AnimatePresence initial={false}>
            {visible.map((f) => (
              <FindingCard
                key={f.id}
                finding={f}
                active={selectedId === f.id}
                onSelect={() => onSelect(f.id)}
                onDecide={(v, note) => onDecide(f.id, v, note)}
                onInvestigate={(msg) => onInvestigate(f.id, msg)}
                onReopenDecision={() => onReopen(f.id)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      <div className="space-y-2 border-t border-border bg-muted/30 px-4 py-3">
        {filter === "open" && counts.dismissed > 0 && (
          <button
            className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => setShowDismissed((v) => !v)}
          >
            {showDismissed ? (
              <EyeOff className="size-3" />
            ) : (
              <Eye className="size-3" />
            )}
            {showDismissed ? "Hide" : "Show"} {counts.dismissed} dismissed
          </button>
        )}

        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {counts.agreed + counts.dismissed}/{findings.length} decided
          </span>
          <Button
            size="sm"
            disabled={!allDecided}
            onClick={() => onGenerateReview?.()}
          >
            Generate review
          </Button>
        </div>
      </div>
    </div>
  );
}

function CountPill({ n }: { n: number }) {
  return (
    <span
      className={cn(
        "ml-1 rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-semibold tabular-nums"
      )}
    >
      {n}
    </span>
  );
}

function SortDropdown({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (k: SortKey) => void;
}) {
  const labels: Record<SortKey, string> = {
    severity: "Severity",
    page: "Page",
    confidence: "Confidence",
  };
  const keys: SortKey[] = ["severity", "page", "confidence"];
  const next = keys[(keys.indexOf(value) + 1) % keys.length];
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onChange(next)}
      className="gap-1.5 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <SortAsc className="size-3" />
      Sort: {labels[value]}
    </Button>
  );
}

function EmptyFilter({ filter }: { filter: FilterKey }) {
  const messages: Record<FilterKey, string> = {
    open: "Every finding decided. Ready to generate the review.",
    agreed: "No findings agreed yet.",
    dismissed: "No findings dismissed.",
  };
  return (
    <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
      {messages[filter]}
    </div>
  );
}
