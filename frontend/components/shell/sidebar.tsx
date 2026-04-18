"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Github, BookOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import { LoupeLockup } from "@/components/brand/loupe-mark";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { UserChip } from "@/components/shell/user-chip";
import { useGlossary } from "@/lib/hooks/use-glossary";

const nav = [{ href: "/papers", label: "Papers", icon: FileText }];

export function Sidebar() {
  const pathname = usePathname();
  const openGlossary = useGlossary((s) => s.openAt);
  return (
    <aside className="flex h-screen w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center px-5 pt-7 pb-6">
        <Link
          href="/papers"
          aria-label="Loupe"
          className="block transition-opacity hover:opacity-80"
        >
          <LoupeLockup height={40} />
        </Link>
      </div>

      <nav className="flex-1 px-3">
        <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
          Workspace
        </div>
        {nav.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex h-9 items-center gap-2.5 rounded-md px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              )}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-2">
        <UserChip />
        <div className="mt-1 flex items-center justify-between gap-1 px-1">
          <div className="flex items-center gap-0.5">
            <Link
              href="https://github.com/morphmind/loupe"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
            >
              <Github className="size-3" /> GitHub
            </Link>
            <button
              onClick={() => openGlossary()}
              className="inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              aria-label="Open glossary"
            >
              <BookOpen className="size-3" /> Glossary
            </button>
          </div>
          <ThemeToggle />
        </div>
        <div className="mt-1 px-1.5 text-[10px] text-muted-foreground/70">
          An open-source agent by MorphMind
        </div>
      </div>
    </aside>
  );
}
