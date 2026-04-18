"use client";

import * as React from "react";
import { BookOpen } from "lucide-react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useGlossary } from "@/lib/hooks/use-glossary";
import { GLOSSARY, type GlossarySection, type GlossaryTerm } from "@/lib/glossary";
import { SEVERITY_META } from "@/components/workspace/issue-type";
import { IssueIcon } from "@/components/workspace/issue-icon";

export function GlossarySheet() {
  const { open, sectionId, termId, openAt, close } = useGlossary();
  const activeSectionId = sectionId ?? GLOSSARY[0].id;

  const contentRef = React.useRef<HTMLDivElement>(null);
  const sectionRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const termRefs = React.useRef<Record<string, HTMLElement | null>>({});

  // Scroll to section (and term) when the store tells us to.
  React.useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      const target =
        (termId && termRefs.current[`${activeSectionId}.${termId}`]) ||
        sectionRefs.current[activeSectionId];
      if (target && contentRef.current) {
        contentRef.current.scrollTo({
          top: target.offsetTop - 16,
          behavior: "smooth",
        });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, activeSectionId, termId]);

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? null : close())}>
      <SheetContent
        side="right"
        className="flex flex-col gap-0 p-0 sm:max-w-[460px]"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <header className="flex items-center gap-2 border-b border-border px-5 py-4">
          <div className="grid size-8 place-items-center rounded-md bg-primary/10 text-primary">
            <BookOpen className="size-4" />
          </div>
          <div>
            <SheetTitle>Loupe glossary</SheetTitle>
            <SheetDescription className="text-[11px]">
              Definitions for every concept in the app. Click any (i) icon in the
              app to jump here.
            </SheetDescription>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[130px_minmax(0,1fr)]">
          <nav className="overflow-y-auto border-r border-border bg-muted/30 px-2 py-3">
            {GLOSSARY.map((s) => (
              <button
                key={s.id}
                onClick={() => openAt(s.id)}
                className={cn(
                  "w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
                  activeSectionId === s.id
                    ? "bg-background font-semibold text-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                )}
              >
                {s.title}
              </button>
            ))}
          </nav>

          <div
            ref={contentRef}
            className="min-h-0 overflow-y-auto px-5 py-5"
          >
            {GLOSSARY.map((section) => (
              <section
                key={section.id}
                ref={(el) => {
                  sectionRefs.current[section.id] = el;
                }}
                className="mb-10 scroll-mt-4"
              >
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-foreground/90">
                  {section.intro}
                </p>
                <div className="mt-4 space-y-4">
                  {section.terms.map((term) => (
                    <div
                      key={term.id}
                      ref={(el) => {
                        termRefs.current[`${section.id}.${term.id}`] = el;
                      }}
                      className="scroll-mt-4"
                    >
                      <TermRow term={term} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>

        <footer className="border-t border-border bg-muted/30 px-5 py-2.5 text-[11px] text-muted-foreground">
          Loupe · open-source by MorphMind ·{" "}
          <a
            href="https://github.com/morphmind/loupe"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-foreground"
          >
            GitHub
          </a>
        </footer>
      </SheetContent>
    </Sheet>
  );
}

function TermRow({ term }: { term: GlossaryTerm }) {
  return (
    <div className="flex gap-3">
      <div className="flex w-8 shrink-0 justify-center pt-0.5">
        <TermIcon term={term} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">
            {term.label}
          </span>
        </div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-foreground/90">
          {term.short}
        </p>
        {term.example && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground/70">Example. </span>
            {term.example}
          </p>
        )}
      </div>
    </div>
  );
}

function TermIcon({ term }: { term: GlossaryTerm }) {
  if (term.issueType) {
    return (
      <span className="grid size-7 place-items-center rounded-md border border-border text-muted-foreground">
        <IssueIcon type={term.issueType} size={14} />
      </span>
    );
  }
  if (term.severity) {
    const sev = SEVERITY_META[term.severity];
    return (
      <span
        className={cn(
          "grid size-7 place-items-center rounded-full text-[10px] font-semibold uppercase tracking-wide",
          sev.chip
        )}
      >
        {term.severity[0].toUpperCase()}
      </span>
    );
  }
  return <span className="size-7" aria-hidden />;
}
