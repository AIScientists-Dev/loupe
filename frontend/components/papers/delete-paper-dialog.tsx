"use client";

import * as React from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useDeletePaper } from "@/lib/hooks/use-papers";
import type { PaperSummary } from "@/lib/types";

export function DeletePaperDialog({
  paper,
  open,
  onOpenChange,
  onDeleted,
}: {
  paper: Pick<PaperSummary, "id" | "title">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const del = useDeletePaper();

  const handleConfirm = async () => {
    try {
      await del.mutateAsync(paper.id);
      toast.success("Paper deleted", {
        description: `"${paper.title}" was removed.`,
      });
      onOpenChange(false);
      onDeleted?.();
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : undefined,
      });
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
              <Trash2 className="size-4" />
            </div>
            <div className="flex-1">
              <AlertDialogTitle>Delete this paper?</AlertDialogTitle>
              <AlertDialogDescription className="mt-1">
                <strong className="text-foreground">{paper.title}</strong> will
                be permanently removed. All findings, decisions, exchanges, and
                draft reviews for this paper go with it.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleConfirm();
            }}
            disabled={del.isPending}
            className={cn(
              buttonVariants({ variant: "destructive" }),
              "min-w-[8rem]"
            )}
          >
            {del.isPending ? "Deleting…" : "Delete paper"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
