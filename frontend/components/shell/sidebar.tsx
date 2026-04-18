"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Github, BookOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import { LoupeMark } from "@/components/brand/loupe-mark";
import { ThemeToggle } from "@/components/shell/theme-toggle";

const nav = [{ href: "/papers", label: "Papers", icon: FileText }];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex h-screen w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-4 pt-5 pb-4">
        <LoupeMark size={22} />
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight">Loupe</span>
          <span className="text-[11px] text-muted-foreground">by MorphMind</span>
        </div>
      </div>

      <nav className="flex-1 px-2 py-2">
        {nav.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors",
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

      <div className="flex items-center justify-between gap-1 border-t border-sidebar-border px-2 py-2">
        <div className="flex items-center gap-1">
          <Link
            href="https://github.com/morphmind/loupe"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <Github className="size-3.5" /> GitHub
          </Link>
          <Link
            href="https://github.com/morphmind/loupe#readme"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
          >
            <BookOpen className="size-3.5" /> Docs
          </Link>
        </div>
        <ThemeToggle />
      </div>
    </aside>
  );
}
