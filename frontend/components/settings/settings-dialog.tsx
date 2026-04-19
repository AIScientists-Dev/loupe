"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useSettingsDialog } from "@/lib/hooks/use-settings-dialog";
import { SettingsPanel } from "./settings-panel";

export function SettingsDialog() {
  const { open, setOpen } = useSettingsDialog();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        {/* Glass-blur backdrop covering everything behind */}
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-background/40 backdrop-blur-md",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          )}
        />
        {/* Centered panel ~ 2/3 viewport */}
        <DialogPrimitive.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex h-[min(88vh,820px)] w-[min(66vw,960px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          )}
        >
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div>
              <DialogPrimitive.Title className="text-lg font-semibold tracking-tight">
                Settings
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-0.5 text-xs text-muted-foreground">
                Local preferences. Nothing here leaves your machine.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Close settings"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          <div className="flex-1 overflow-y-auto px-6 pb-6">
            <SettingsPanel />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
