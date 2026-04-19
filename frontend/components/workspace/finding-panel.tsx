"use client";

import * as React from "react";
import { AnimatePresence } from "framer-motion";
import { Eye, EyeOff, SortAsc } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useHotkeys } from "@/lib/hooks/use-hotkeys";
import { useGlossary } from "@/lib/hooks/use-glossary";
import { InfoTrigger } from "@/components/glossary/info-trigger";
import { FindingCard } from "./finding-card";
import type { Finding } from "@/lib/types";

type FilterKey = "open" | "agreed" | "dismissed";
type SortKey = "severity" | "page";

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * Imperative signal to reopen a previously-decided finding: switches the panel
 * filter to the matching tab and opens the card in editing mode with the note
 * textarea pre-rendered. Keyed on `v` so the same id can fire repeatedly.
 */
export type FocusEditSignal = {
  id: string;
  decision: "agree" | "dismiss";
  v: number;
};

export function FindingPanel({
  findings,
  selectedId,
  onSelect,
  onDecide,
  onInvestigate,
  onGenerateReview,
  focusEdit,
  readOnly,
}: {
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDecide: (id: string, verdict: "agree" | "dismiss", note?: string) => Promise<void>;
  onInvestigate: (id: string, message: string) => Promise<void>;
  onGenerateReview?: () => void;
  focusEdit?: FocusEditSignal;
  readOnly?: boolean;
}) {
  const [filter, setFilter] = React.useState<FilterKey>("open");
  const [sort, setSort] = React.useState<SortKey>("severity");
  const [showDismissed, setShowDismissed] = React.useState(false);
  const openGlossary = useGlossary((s) => s.openAt);

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
      return 0;
    });
    return list;
  }, [findings, filter, sort, showDismissed]);

  const allDecided = counts.open === 0 && findings.length > 0;

  const selectNextBy = React.useCallback(
    (delta: 1 | -1) => {
      if (!visible.length) return;
      const idx = visible.findIndex((f) => f.id === selectedId);
      const nextIdx =
        idx === -1
          ? 0
          : Math.max(0, Math.min(visible.length - 1, idx + delta));
      onSelect(visible[nextIdx].id);
    },
    [visible, selectedId, onSelect]
  );

  // Minimal hotkeys: navigation + glossary. Decision shortcuts were removed —
  // they bypassed the note textarea, which confused the decide flow.
  useHotkeys([
    {
      keys: ["j", "ArrowDown"],
      handler: (e) => {
        e.preventDefault();
        selectNextBy(1);
      },
    },
    {
      keys: ["k", "ArrowUp"],
      handler: (e) => {
        e.preventDefault();
        selectNextBy(-1);
      },
    },
    {
      keys: ["h"],
      handler: (e) => {
        e.preventDefault();
        openGlossary();
      },
    },
  ]);

  // Reopen flow: when focusEdit fires, switch filter to the decided tab so
  // the target card is rendered, then pass a commandSignal to open editing
  // mode in the right verdict.
  React.useEffect(() => {
    if (!focusEdit) return;
    setFilter(focusEdit.decision === "agree" ? "agreed" : "dismissed");
    onSelect(focusEdit.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEdit?.v]);

  return (
    <div className="flex h-full w-full flex-col border-l border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-1">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as FilterKey)}>
            <TabsList className="h-8 p-0.5">
              <TabsTrigger value="open" className="px-2 py-0.5 text-[11px]">
                Open <CountPill n={counts.open} />
              </TabsTrigger>
              <TabsTrigger value="agreed" className="px-2 py-0.5 text-[11px]">
                Agreed <CountPill n={counts.agreed} />
              </TabsTrigger>
              <TabsTrigger value="dismissed" className="px-2 py-0.5 text-[11px]">
                Dismissed <CountPill n={counts.dismissed} />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <InfoTrigger
            section="decisions"
            label="About decisions"
            size={12}
          />
        </div>

        <div className="flex shrink-0 items-center gap-1">
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
                commandSignal={
                  focusEdit && focusEdit.id === f.id
                    ? { mode: focusEdit.decision, v: focusEdit.v }
                    : undefined
                }
                readOnly={readOnly}
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
  };
  const keys: SortKey[] = ["severity", "page"];
  const next = keys[(keys.indexOf(value) + 1) % keys.length];
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => onChange(next)}
      className="h-7 shrink-0 gap-1 whitespace-nowrap px-2 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <SortAsc className="size-3" />
      {labels[value]}
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
