"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { paperKeys } from "@/lib/hooks/use-papers";
import type { PaperSummary } from "@/lib/types";

/**
 * Rename a paper. No backend endpoint exists for this yet, so the mutation
 * optimistically updates local caches. When the backend adds PATCH /papers/{id}
 * with a `title` body field, swap this for a real call.
 */
function useRenamePaper() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      await new Promise((r) => setTimeout(r, 200));
      return { id, title };
    },
    onSuccess: ({ id, title }) => {
      qc.setQueryData<PaperSummary[]>(paperKeys.list(), (old) =>
        old ? old.map((p) => (p.id === id ? { ...p, title } : p)) : old
      );
      qc.setQueryData<{ title: string } | undefined>(
        paperKeys.detail(id),
        (old) => (old ? { ...old, title } : old)
      );
    },
  });
}

export function RenamePaperDialog({
  paper,
  open,
  onOpenChange,
}: {
  paper: Pick<PaperSummary, "id" | "title">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const rename = useRenamePaper();
  const [title, setTitle] = React.useState(paper.title);

  React.useEffect(() => {
    if (open) setTitle(paper.title);
  }, [open, paper.title]);

  const handleSave = async () => {
    const next = title.trim();
    if (!next || next === paper.title) {
      onOpenChange(false);
      return;
    }
    try {
      await rename.mutateAsync({ id: paper.id, title: next });
      toast.success("Renamed");
      onOpenChange(false);
    } catch (err) {
      toast.error("Rename failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Pencil className="size-4" />
            </div>
            <div className="flex-1">
              <DialogTitle>Rename paper</DialogTitle>
              <DialogDescription className="mt-1">
                Only affects how this paper appears in your list — the original
                filename is unchanged.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rename-title" className="text-xs">
            Title
          </Label>
          <Input
            id="rename-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={rename.isPending}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={rename.isPending}>
            {rename.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
