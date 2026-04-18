"use client";

import * as React from "react";
import { Info } from "lucide-react";

import { cn } from "@/lib/utils";
import { useGlossary } from "@/lib/hooks/use-glossary";

export function InfoTrigger({
  section,
  term,
  label,
  className,
  size = 12,
}: {
  section: string;
  term?: string;
  /** aria-label, describes what the (i) opens — keeps screen readers happy. */
  label: string;
  className?: string;
  size?: number;
}) {
  const openAt = useGlossary((s) => s.openAt);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        openAt(section, term);
      }}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground",
        className
      )}
    >
      <Info style={{ width: size, height: size }} />
    </button>
  );
}
