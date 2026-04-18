"use client";

import * as React from "react";
import { BookOpen, Search, X as XIcon } from "lucide-react";

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

/** Primary nav — everything else lives under "Under the hood". */
const ESSENTIAL_SECTIONS = ["severity", "issue-types", "decisions", "shortcuts"];

export function GlossarySheet() {
  const { open, sectionId, termId, openAt, close } = useGlossary();
  const activeSectionId = sectionId ?? GLOSSARY[0].id;
  const [query, setQuery] = React.useState("");

  const contentRef = React.useRef<HTMLDivElement>(null);
  const sectionRefs = React.useRef<Record<string, HTMLElement | null>>({});
  const termRefs = React.useRef<Record<string, HTMLElement | null>>({});

  // Clear search when sheet closes.
  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  // Scroll to the target section/term. Uses scrollIntoView with explicit
  // container-relative math so it lands even inside a flex-min-height scroll area.
  React.useEffect(() => {
    if (!open || query) return;
    const raf = requestAnimationFrame(() => {
      const target =
        (termId && termRefs.current[`${activeSectionId}.${termId}`]) ||
        sectionRefs.current[activeSectionId];
      const container = contentRef.current;
      if (!target || !container) return;
      const targetTop =
        target.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      container.scrollTo({ top: targetTop - 8, behavior: "smooth" });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, activeSectionId, termId, query]);

  const filtered = React.useMemo(() => filterGlossary(query), [query]);

  const essential = filtered.filter((s) => ESSENTIAL_SECTIONS.includes(s.id));
  const advanced = filtered.filter((s) => !ESSENTIAL_SECTIONS.includes(s.id));

  const inputRef = React.useRef<HTMLInputElement>(null);

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? null : close())}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[460px] md:w-[58vw] md:min-w-[640px] md:max-w-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <header className="flex items-start gap-3 border-b border-border px-5 py-4 pr-12">
          <div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <BookOpen className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <SheetTitle>Loupe glossary</SheetTitle>
            <SheetDescription className="mt-0.5 text-[11px]">
              Definitions for every concept in the app. Click any (i) icon to
              jump here, or press <kbd className="rounded bg-muted px-1 py-px font-mono text-[10px]">h</kbd>.
            </SheetDescription>
          </div>
        </header>

        {/* Search */}
        <div className="border-b border-border px-5 py-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the glossary…"
              className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-8 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Search glossary"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search"
              >
                <XIcon className="size-3" />
              </button>
            )}
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(0,1fr)] md:grid-cols-[180px_minmax(0,1fr)]">
          <nav className="overflow-y-auto border-r border-border bg-muted/30 px-2 py-3">
            {essential.length > 0 && (
              <NavGroup label="Read me first">
                {essential.map((s) => (
                  <NavItem
                    key={s.id}
                    section={s}
                    active={activeSectionId === s.id && !query}
                    onClick={() => openAt(s.id)}
                  />
                ))}
              </NavGroup>
            )}
            {advanced.length > 0 && (
              <NavGroup label="Under the hood" className="mt-3">
                {advanced.map((s) => (
                  <NavItem
                    key={s.id}
                    section={s}
                    active={activeSectionId === s.id && !query}
                    onClick={() => openAt(s.id)}
                  />
                ))}
              </NavGroup>
            )}
            {filtered.length === 0 && (
              <div className="px-2 py-4 text-[11px] text-muted-foreground">
                No matches.
              </div>
            )}
          </nav>

          <div ref={contentRef} className="min-h-0 overflow-y-auto px-5 py-5">
            {filtered.length === 0 ? (
              <div className="grid h-full place-items-center text-center text-sm text-muted-foreground">
                Nothing matched &ldquo;{query}&rdquo;. Try a different word.
              </div>
            ) : (
              filtered.map((section) => (
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
                        <TermRow term={term} highlight={query} />
                      </div>
                    ))}
                  </div>
                </section>
              ))
            )}
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

function NavGroup({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        {label}
      </div>
      {children}
    </div>
  );
}

function NavItem({
  section,
  active,
  onClick,
}: {
  section: GlossarySection;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "mb-0.5 w-full rounded-md px-2.5 py-1.5 text-left text-xs transition-colors",
        active
          ? "bg-background font-semibold text-foreground shadow-sm"
          : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
      )}
    >
      {section.title}
    </button>
  );
}

function TermRow({ term, highlight }: { term: GlossaryTerm; highlight: string }) {
  return (
    <div className="flex gap-3">
      <div className="flex w-8 shrink-0 justify-center pt-0.5">
        <TermIcon term={term} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-sm font-semibold text-foreground">
            <Highlight text={term.label} q={highlight} />
          </span>
        </div>
        <p className="mt-0.5 text-[13px] leading-relaxed text-foreground/90">
          <Highlight text={term.short} q={highlight} />
        </p>
        {term.example && (
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground/70">Example. </span>
            <Highlight text={term.example} q={highlight} />
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

/** Filter sections + terms by case-insensitive substring match on label/short/example. */
function filterGlossary(query: string): GlossarySection[] {
  const q = query.trim().toLowerCase();
  if (!q) return GLOSSARY;
  const out: GlossarySection[] = [];
  for (const section of GLOSSARY) {
    const sectionMatches =
      section.title.toLowerCase().includes(q) ||
      section.intro.toLowerCase().includes(q);
    const filteredTerms = section.terms.filter(
      (t) =>
        t.label.toLowerCase().includes(q) ||
        t.short.toLowerCase().includes(q) ||
        (t.example?.toLowerCase().includes(q) ?? false)
    );
    if (sectionMatches || filteredTerms.length > 0) {
      out.push({
        ...section,
        terms: sectionMatches && filteredTerms.length === 0 ? section.terms : filteredTerms,
      });
    }
  }
  return out;
}

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q.trim()) return <>{text}</>;
  const needle = q.trim().toLowerCase();
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let i = 0;
  while (i < text.length) {
    const hit = lower.indexOf(needle, i);
    if (hit === -1) {
      parts.push(text.slice(i));
      break;
    }
    if (hit > i) parts.push(text.slice(i, hit));
    parts.push(
      <mark
        key={hit}
        className="rounded bg-highlight/40 px-0.5 py-0 text-inherit"
      >
        {text.slice(hit, hit + needle.length)}
      </mark>
    );
    i = hit + needle.length;
  }
  return <>{parts}</>;
}
