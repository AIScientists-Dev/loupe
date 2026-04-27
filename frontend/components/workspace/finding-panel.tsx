"use client";

import * as React from "react";
import { AnimatePresence } from "framer-motion";
import { Eye, EyeOff, History, SortAsc, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { InfoTrigger } from "@/components/glossary/info-trigger";
import { FindingCard } from "./finding-card";
import { CostSummaryTrigger } from "./cost-drawer";
import { api } from "@/lib/api";
import type { Dimension, DraftReviewSummary, Finding } from "@/lib/types";

const DIMENSION_FILTERS: Array<{ value: Dimension | "all"; label: string }> = [
  { value: "all", label: "All dimensions" },
  { value: "proof", label: "Proof" },
  { value: "literature", label: "Literature" },
  { value: "clarity", label: "Clarity" },
  { value: "numerical", label: "Numerical" },
  { value: "relevance", label: "Relevance" },
  { value: "novelty", label: "Novelty" },
];

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
  onRequestPlacement,
  onGenerateReview,
  paperId,
  focusEdit,
  onClose,
  readOnly,
}: {
  findings: Finding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDecide: (id: string, verdict: "agree" | "dismiss", note?: string) => Promise<void>;
  onInvestigate: (id: string, message: string) => Promise<void>;
  /** Enter crosshair mode to manually place this finding on the PDF. */
  onRequestPlacement?: (id: string) => void;
  /** Open the draft review dialog. Pass a draftId to load a historical draft. */
  onGenerateReview?: (draftId?: string) => void;
  /** Paper ID — required to fetch the draft history list. */
  paperId?: string;
  focusEdit?: FocusEditSignal;
  /** When provided (narrow viewports), a close button renders in the header. */
  onClose?: () => void;
  readOnly?: boolean;
}) {
  const [filter, setFilter] = React.useState<FilterKey>("open");
  const [sort, setSort] = React.useState<SortKey>("severity");
  const [showDismissed, setShowDismissed] = React.useState(false);
  const [dimensionFilter, setDimensionFilter] = React.useState<Dimension | "all">("all");

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
    // v2: cross-cutting dimension filter — `proof` is the default for legacy
    // findings, so we treat undefined as "proof" when filtering.
    if (dimensionFilter !== "all") {
      list = list.filter((f) => (f.dimension ?? "proof") === dimensionFilter);
    }
    list.sort((a, b) => {
      if (sort === "severity")
        return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      if (sort === "page") return (a.bbox_page ?? 0) - (b.bbox_page ?? 0);
      return 0;
    });
    return list;
  }, [findings, filter, sort, showDismissed, dimensionFilter]);

  const allDecided = counts.open === 0 && findings.length > 0;

  // Scroll container + lookup for the selected card so we can align it to
  // the top after a decision auto-advances.
  const listRef = React.useRef<HTMLDivElement | null>(null);

  // Wrap onDecide: after a successful decision, advance selection to the
  // next visible finding (or previous if we were on the last one). A
  // useEffect on `selectedId` scrolls the new card to the top.
  const handleDecide = React.useCallback(
    async (id: string, verdict: "agree" | "dismiss", note?: string) => {
      const idx = visible.findIndex((f) => f.id === id);
      const nextId =
        idx >= 0
          ? (visible[idx + 1]?.id ?? visible[idx - 1]?.id ?? null)
          : null;
      await onDecide(id, verdict, note);
      if (nextId) onSelect(nextId);
    },
    [visible, onDecide, onSelect]
  );

  React.useEffect(() => {
    if (!selectedId) return;
    const root = listRef.current;
    if (!root) return;
    // Double rAF: wait one frame for the parent render, a second so the
    // FindingCard's own commandSignal effect has expanded into editing mode
    // (which changes the card's height) before we measure and scroll.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const el = root.querySelector<HTMLElement>(
          `[data-finding-id="${selectedId}"]`
        );
        if (!el) return;
        const delta =
          el.getBoundingClientRect().top - root.getBoundingClientRect().top;
        root.scrollTo({ top: root.scrollTop + delta - 8, behavior: "smooth" });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [selectedId, visible.length, focusEdit?.v]);

  // Reopen flow: when focusEdit fires, switch filter to the decided tab so
  // the target card is rendered, then pass a commandSignal to open editing
  // mode in the right verdict.
  React.useEffect(() => {
    if (!focusEdit) return;
    setFilter(focusEdit.decision === "agree" ? "agreed" : "dismissed");
    onSelect(focusEdit.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEdit?.v]);

  // When the PDF (or any external source) selects a finding that's hidden by
  // the current filter, auto-switch to the tab that contains it so the card
  // actually renders and can be scrolled into view.
  React.useEffect(() => {
    if (!selectedId) return;
    const f = findings.find((x) => x.id === selectedId);
    if (!f) return;
    const targetFilter: FilterKey =
      f.decision === "agree" ? "agreed" : f.decision === "dismiss" ? "dismissed" : "open";
    if (targetFilter !== filter) setFilter(targetFilter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

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
          {paperId && <CostSummaryTrigger paperId={paperId} />}
          <DimensionDropdown
            value={dimensionFilter}
            onChange={setDimensionFilter}
          />
          <SortDropdown value={sort} onChange={setSort} />
          {onClose && (
            <Button
              size="icon-xs"
              variant="ghost"
              onClick={onClose}
              aria-label="Close findings panel"
            >
              <X className="size-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto p-4">
        {visible.length === 0 ? (
          <EmptyFilter
            filter={filter}
            totalFindings={findings.length}
            openCount={counts.open}
          />
        ) : (
          <AnimatePresence initial={false}>
            {visible.map((f) => (
              <FindingCard
                key={f.id}
                data-finding-id={f.id}
                finding={f}
                active={selectedId === f.id}
                onSelect={() => onSelect(f.id)}
                onDecide={(v, note) => handleDecide(f.id, v, note)}
                onInvestigate={(msg) => onInvestigate(f.id, msg)}
                onRequestPlacement={
                  onRequestPlacement
                    ? () => onRequestPlacement(f.id)
                    : undefined
                }
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
          <div className="flex items-center gap-1.5">
            {paperId && (
              <ReviewHistoryMenu
                paperId={paperId}
                onPick={(draftId) => onGenerateReview?.(draftId)}
              />
            )}
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
    </div>
  );
}

function ReviewHistoryMenu({
  paperId,
  onPick,
}: {
  paperId: string;
  onPick: (draftId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [drafts, setDrafts] = React.useState<DraftReviewSummary[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Refetch every time the menu opens so the list is always current — drafts
  // are created asynchronously by the backend, not only in response to the UI.
  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api
      .listReviews(paperId)
      .then((list) => {
        if (!cancelled) setDrafts(list);
      })
      .catch(() => {
        if (!cancelled) setDrafts([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, paperId]);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="size-8 p-0"
          aria-label="Review history"
          title="Previous reviews"
        >
          <History className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Previous drafts
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {loading ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">Loading…</div>
        ) : !drafts || drafts.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">
            No drafts yet. Generate one to see it here.
          </div>
        ) : (
          drafts.map((d) => (
            <DropdownMenuItem
              key={d.draft_id}
              onSelect={() => onPick(d.draft_id)}
              className="flex-col items-start gap-0.5"
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {fmtRelative(d.updated_at)}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {d.word_count}w
                </span>
              </div>
              <div className="line-clamp-2 text-[11px] text-muted-foreground">
                {d.preview || "(empty)"}
              </div>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function fmtRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diff = Date.now() - then;
  const s = Math.round(diff / 1000);
  if (s < 10) return "Just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(then).toLocaleDateString();
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

function DimensionDropdown({
  value,
  onChange,
}: {
  value: Dimension | "all";
  onChange: (v: Dimension | "all") => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Dimension | "all")}
      className="h-7 shrink-0 rounded-md border border-border bg-background px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
      aria-label="Filter by review dimension"
    >
      {DIMENSION_FILTERS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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

function EmptyFilter({
  filter,
  totalFindings,
  openCount,
}: {
  filter: FilterKey;
  totalFindings: number;
  openCount: number;
}) {
  // Special case: no findings at all yet. This can happen while the paper is
  // still being analyzed, or when Loupe genuinely found nothing. "Every
  // finding decided" is wrong in either case.
  let message: string;
  if (totalFindings === 0) {
    message = "Scanning for issues… findings will appear here as they're surfaced.";
  } else if (filter === "open" && openCount === 0) {
    message = "Every finding decided. Ready to generate the review.";
  } else if (filter === "open") {
    message = "No open findings in this view.";
  } else if (filter === "agreed") {
    message = "No findings agreed yet.";
  } else {
    message = "No findings dismissed.";
  }
  return (
    <div className="grid h-full place-items-center px-6 text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}
