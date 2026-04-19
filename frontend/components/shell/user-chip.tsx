"use client";

import * as React from "react";
import { Settings as SettingsIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { initialsFor, useProfile } from "@/lib/hooks/use-profile";
import { useSettingsDialog } from "@/lib/hooks/use-settings-dialog";

/**
 * Sidebar footer chip. Click → opens Settings modal directly (no dropdown).
 */
export function UserChip() {
  const profile = useProfile();
  const openSettings = useSettingsDialog((s) => s.openDialog);

  return (
    <button
      onClick={openSettings}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-left transition-colors hover:border-sidebar-border hover:bg-sidebar-accent/60"
      )}
      aria-label="Open settings"
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
        )}
      >
        {initialsFor(profile)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">
          {profile.name}
        </div>
        <div className="truncate text-[10px] text-muted-foreground">
          {profile.signedIn ? profile.email : "Local · not signed in"}
        </div>
      </div>
      <SettingsIcon className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" />
    </button>
  );
}
