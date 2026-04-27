"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckSquare,
  Loader2,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useBatchSelect } from "@/lib/hooks/use-batch-select";
import { useFolderStore } from "@/lib/hooks/use-folder-store";
import { paperKeys } from "@/lib/hooks/use-papers";
import type { PaperSummary } from "@/lib/types";

interface Props {
  papers: PaperSummary[];
}

/**
 * Floating action bar shown along the bottom of the library while batch
 * select mode is active. Surfaces the bulk operations the user described:
 *   - Dive deep   (skips papers already diving / dived)
 *   - Promising   (sets flag, doesn't touch stage)
 *   - Reject      (sets flag, doesn't touch stage)
 *   - Move        (assigns folder)
 *   - Delete      (hard-deletes papers + their stored data)
 *
 * Calls run sequentially today — once /v1/papers/batch lands (V3 spec §2),
 * we swap the loop for a single endpoint call. The UI shape doesn't change.
 */
export function BatchActionBar({ papers }: Props) {
  const qc = useQueryClient();
  const active = useBatchSelect((s) => s.active);
  const selected = useBatchSelect((s) => s.selected);
  const enter = useBatchSelect((s) => s.enter);
  const exit = useBatchSelect((s) => s.exit);
  const selectAll = useBatchSelect((s) => s.selectAll);
  const clear = useBatchSelect((s) => s.clear);

  const folders = useFolderStore((s) => s.folders);

  const [busy, setBusy] = React.useState<null | string>(null);

  const selectedPapers = React.useMemo(
    () => papers.filter((p) => selected.has(p.id)),
    [papers, selected],
  );

  const allSelected = papers.length > 0 && selected.size === papers.length;

  // ---- Bulk actions ------------------------------------------------------

  // v3: every bulk action is now a single round-trip to /v1/papers/batch.
  // The backend handles per-paper success/skip/error reporting (idempotent
  // dive-deep, folder validation, etc.). We surface its `summary` directly
  // in the toast so the user sees the same numbers the server saw.
  const runBatch = async (
    label: string,
    action: "dive_deep" | "flag" | "set_folder" | "delete",
    payload?: Record<string, unknown>,
    successCopy?: (summary: { ok: number; failed: number }, skipped: number) => string,
  ) => {
    setBusy(label);
    try {
      const ids = selectedPapers.map((p) => p.id);
      const resp = await api.batchPapers({ ids, action, payload });
      const skipped = resp.results.filter((r) => r.skipped).length;
      const fallbackDesc =
        [
          skipped > 0 && `${skipped} already processed`,
          resp.summary.failed > 0 && `${resp.summary.failed} failed`,
        ]
          .filter(Boolean)
          .join(" · ") || undefined;
      const description = successCopy?.(resp.summary, skipped) ?? fallbackDesc;
      qc.invalidateQueries({ queryKey: paperKeys.list() });
      toast.success(
        `${label} · ${resp.summary.ok} paper${resp.summary.ok === 1 ? "" : "s"}`,
        { description },
      );
      exit();
    } catch (e) {
      toast.error(`${label} failed`, {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setBusy(null);
    }
  };

  const dive = () => runBatch("Dive deep", "dive_deep");
  const flagAll = (kind: "promising" | "rejected") =>
    runBatch(kind === "promising" ? "Promising" : "Reject", "flag", { flag: kind });
  const moveTo = (folder: string) =>
    runBatch(`Moved to ${folder}`, "set_folder", { folder });
  const deleteAll = async () => {
    if (
      !window.confirm(
        `Delete ${selectedPapers.length} paper${selectedPapers.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    )
      return;
    await runBatch("Deleted", "delete");
  };

  // ---- Render ------------------------------------------------------------

  if (!active) {
    return (
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={enter} className="gap-1.5">
          <CheckSquare className="size-3.5" /> Select
        </Button>
      </div>
    );
  }

  return (
    <>
      {/* Inline header pill so the user knows they're in select mode */}
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            allSelected ? clear() : selectAll(papers.map((p) => p.id))
          }
          className="gap-1.5"
        >
          {allSelected ? (
            <CheckSquare className="size-3.5 text-primary" />
          ) : (
            <Square className="size-3.5" />
          )}
          {allSelected ? "Deselect all" : "Select all"}
        </Button>
        <Button size="sm" variant="ghost" onClick={exit} className="gap-1.5">
          <X className="size-3.5" /> Exit
        </Button>
      </div>

      {/* Floating bottom bar — only renders while at least one paper is selected. */}
      {selected.size > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-full items-center gap-2 overflow-x-auto rounded-full border border-border bg-popover p-1.5 shadow-lg">
            <span className="shrink-0 px-2 text-xs font-medium tabular-nums text-muted-foreground">
              {selected.size} selected
            </span>
            <Separator />
            <BatchButton
              icon={Sparkles}
              label="Dive deep"
              onClick={dive}
              busy={busy === "Dive deep"}
              tone="primary"
            />
            <BatchButton
              icon={ThumbsUp}
              label="Promising"
              onClick={() => flagAll("promising")}
              busy={busy === "Promising"}
            />
            <BatchButton
              icon={ThumbsDown}
              label="Reject"
              onClick={() => flagAll("rejected")}
              busy={busy === "Reject"}
            />
            {folders.length > 0 && (
              <MoveDropdown folders={folders} onPick={moveTo} busy={busy === "Move"} />
            )}
            <BatchButton
              icon={Trash2}
              label="Delete"
              onClick={deleteAll}
              busy={busy === "Delete"}
              tone="destructive"
            />
          </div>
        </div>
      )}
    </>
  );
}

function Separator() {
  return <span className="h-5 w-px shrink-0 bg-border" />;
}

function BatchButton({
  icon: Icon,
  label,
  onClick,
  busy,
  tone = "neutral",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  busy?: boolean;
  tone?: "neutral" | "primary" | "destructive";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
        tone === "primary"
          ? "bg-primary text-primary-foreground hover:bg-primary/90"
          : tone === "destructive"
            ? "text-destructive hover:bg-destructive/10"
            : "text-foreground hover:bg-muted",
      )}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Icon className="size-3.5" />
      )}
      {label}
    </button>
  );
}

function MoveDropdown({
  folders,
  onPick,
  busy,
}: {
  folders: string[];
  onPick: (folder: string) => void;
  busy?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Move to…
      </button>
      {open && (
        <div className="absolute bottom-10 right-0 max-h-64 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
          {folders.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => {
                setOpen(false);
                onPick(f);
              }}
              className="flex w-full items-center px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted"
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
