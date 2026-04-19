"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Github, BookOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import { LoupeLockup, LoupeMark } from "@/components/brand/loupe-mark";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserChip } from "@/components/shell/user-chip";
import { useGlossary } from "@/lib/hooks/use-glossary";
import { initialsFor, useProfile } from "@/lib/hooks/use-profile";
import { useSettingsDialog } from "@/lib/hooks/use-settings-dialog";

const nav = [{ href: "/papers", label: "Papers", icon: FileText }];

const RAIL_W = 60; // collapsed width (rail)
const FULL_W = 260; // expanded width

export function Sidebar() {
  const pathname = usePathname();
  const openGlossary = useGlossary((s) => s.openAt);
  const [expanded, setExpanded] = React.useState(false);

  // Slight delay on collapse prevents flicker when mouse briefly leaves a child.
  const closeTimerRef = React.useRef<number | null>(null);
  const onEnter = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setExpanded(true);
  };
  const onLeave = () => {
    closeTimerRef.current = window.setTimeout(() => setExpanded(false), 120);
  };

  return (
    // In-flow rail — main content shifts only by the rail width.
    <aside
      className="relative h-screen shrink-0"
      style={{ width: RAIL_W }}
      aria-label="Primary navigation"
    >
      <div
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        className={cn(
          "absolute inset-y-0 left-0 z-40 flex flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200",
          expanded ? "shadow-xl" : ""
        )}
        style={{ width: expanded ? FULL_W : RAIL_W }}
      >
        {/* Brand */}
        <div
          className={cn(
            "flex h-[68px] shrink-0 items-center",
            expanded ? "px-3" : "justify-center px-0"
          )}
        >
          <Link
            href="/papers"
            aria-label="Loupe"
            className={cn(
              "flex h-10 items-center transition-opacity hover:opacity-80",
              expanded ? "" : "justify-center"
            )}
          >
            {expanded ? (
              <span className="pl-2">
                <LoupeLockup height={32} />
              </span>
            ) : (
              <LoupeMark size={26} />
            )}
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2">
          {expanded && (
            <div className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              Workspace
            </div>
          )}
          {nav.map((item) => {
            const Icon = item.icon;
            const active =
              pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                title={!expanded ? item.label : undefined}
                className={cn(
                  "group relative flex h-9 items-center rounded-md transition-colors",
                  expanded ? "gap-2.5 px-3" : "justify-center",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
                )}
              >
                <Icon className="size-4 shrink-0" />
                {expanded && (
                  <span className="text-sm font-medium">{item.label}</span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer — User chip + icon row */}
        <div className="border-t border-sidebar-border p-2">
          <CollapsibleUserChip expanded={expanded} />
          <div
            className={cn(
              "mt-1 flex items-center gap-0.5 px-0.5",
              expanded ? "justify-between" : "flex-col gap-1"
            )}
          >
            <div
              className={cn(
                "flex items-center gap-0.5",
                expanded ? "flex-row" : "flex-col"
              )}
            >
              <Link
                href="https://github.com/morphmind/loupe"
                target="_blank"
                rel="noreferrer"
                title="GitHub"
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md text-[11px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  expanded ? "px-1.5" : "size-7 justify-center"
                )}
              >
                <Github className="size-3" />
                {expanded && <span>GitHub</span>}
              </Link>
              <button
                onClick={() => openGlossary()}
                title="Glossary"
                className={cn(
                  "inline-flex h-7 items-center gap-1.5 rounded-md text-[11px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  expanded ? "px-1.5" : "size-7 justify-center"
                )}
                aria-label="Open glossary"
              >
                <BookOpen className="size-3" />
                {expanded && <span>Glossary</span>}
              </button>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </div>
    </aside>
  );
}

function CollapsibleUserChip({ expanded }: { expanded: boolean }) {
  const profile = useProfile();
  const openSettings = useSettingsDialog((s) => s.openDialog);

  if (!expanded) {
    return (
      <button
        onClick={openSettings}
        title={`${profile.name} — Settings`}
        aria-label="Open settings"
        className="grid size-9 w-full place-items-center rounded-md transition-colors hover:bg-sidebar-accent/60"
      >
        <span className="grid size-7 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
          {initialsFor(profile)}
        </span>
      </button>
    );
  }
  return <UserChip />;
}
