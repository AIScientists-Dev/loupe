"use client";

import * as React from "react";
import { Check, Copy, Link2, Eye } from "lucide-react";
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
import { cn } from "@/lib/utils";
import type { PaperSummary } from "@/lib/types";

/**
 * Generates a read-only share URL for a paper. Anyone with the link can
 * view the PDF, findings, decisions, and exchanges — no login required.
 * Actions (agree/dismiss/investigate/delete) are disabled in the read-only view.
 */
export function SharePaperDialog({
  paper,
  open,
  onOpenChange,
}: {
  paper: Pick<PaperSummary, "id" | "title">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [copied, setCopied] = React.useState(false);
  const shareUrl = React.useMemo(() => {
    if (typeof window === "undefined") return `/share/${paper.id}`;
    return `${window.location.origin}/share/${paper.id}`;
  }, [paper.id]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — select the link and copy manually.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              <Link2 className="size-4" />
            </div>
            <div className="flex-1">
              <DialogTitle>Share this review</DialogTitle>
              <DialogDescription className="mt-1">
                Anyone with the link can read{" "}
                <strong className="text-foreground">&ldquo;{paper.title}&rdquo;</strong>,
                your findings, decisions, and comments. Read-only — no login needed.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={shareUrl}
              onFocus={(e) => e.target.select()}
              className="font-mono text-xs"
            />
            <Button onClick={copy} size="sm" className="shrink-0 gap-1.5">
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <p
            className={cn(
              "inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
            )}
          >
            <Eye className="size-3" />
            Recipients can view but not edit, agree, dismiss, or delete.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
