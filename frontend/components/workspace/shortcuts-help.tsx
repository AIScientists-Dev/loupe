"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const GROUPS: { title: string; rows: [string[], string][] }[] = [
  {
    title: "Navigation",
    rows: [
      [["j", "↓"], "Next finding"],
      [["k", "↑"], "Previous finding"],
    ],
  },
  {
    title: "Decide",
    rows: [
      [["a"], "Agree"],
      [["d"], "Dismiss"],
      [["i"], "Investigate"],
    ],
  },
  {
    title: "Review",
    rows: [
      [["r"], "Generate review (when all decided)"],
    ],
  },
  {
    title: "This dialog",
    rows: [
      [["?"], "Show / hide shortcuts"],
      [["Esc"], "Close"],
    ],
  },
];

export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Shortcuts are off when you're typing in an input or textarea.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {g.title}
              </div>
              <dl className="space-y-1">
                {g.rows.map(([keys, label], i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-4 py-1"
                  >
                    <dt className="text-sm text-foreground">{label}</dt>
                    <dd className="flex items-center gap-1">
                      {keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[22px] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground shadow-[0_1px_0_0_rgba(0,0,0,0.04)]">
      {children}
    </kbd>
  );
}
