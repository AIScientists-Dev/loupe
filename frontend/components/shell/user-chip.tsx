"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Settings as SettingsIcon, LogOut } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { initialsFor, useProfile } from "@/lib/hooks/use-profile";

export function UserChip() {
  const profile = useProfile();
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "group flex w-full items-center gap-2.5 rounded-md border border-transparent bg-transparent px-2 py-1.5 text-left transition-colors hover:border-sidebar-border hover:bg-sidebar-accent/60"
          )}
          aria-label="Account menu"
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
          <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6} className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-xs font-semibold text-foreground">
            {profile.name}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {profile.signedIn
              ? profile.email
              : "Local-only session · data never leaves your machine"}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <SettingsIcon className="size-3.5" /> Settings
          </Link>
        </DropdownMenuItem>
        {profile.signedIn && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                profile.signOut();
                toast.success("Signed out", {
                  description: "Local papers and settings remain on this machine.",
                });
                router.push("/papers");
              }}
            >
              <LogOut className="size-3.5" /> Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
