"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Maximize2,
  Ruler,
  FileText,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Formula, MathText } from "./math";
import { PageStrip } from "./page-strip";
import type { Finding, Segment } from "@/lib/types";

const PAGE_W = 612; // PDF points, US letter
const PAGE_H = 792;
const DEFAULT_PAGES = 5;

export function PdfViewer({
  paperTitle,
  findings,
  selectedFindingId,
  segments,
  totalPages,
  onSkipSegment,
}: {
  paperTitle: string;
  findings: Finding[];
  segments?: Segment[];
  totalPages?: number;
  selectedFindingId: string | null;
  onSkipSegment?: (segmentId: string) => void;
}) {
  const [zoom, setZoom] = React.useState(0.95);
  const [currentPage, setCurrentPage] = React.useState(1);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const pageRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  // Scroll + briefly highlight when a finding is selected.
  const selected = findings.find((f) => f.id === selectedFindingId);
  React.useEffect(() => {
    if (!selected || !selected.bbox_page) return;
    const target = pageRefs.current[selected.bbox_page - 1];
    if (target && containerRef.current) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setCurrentPage(selected.bbox_page);
    }
  }, [selectedFindingId, selected]);

  React.useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) {
          const pg = Number((visible.target as HTMLElement).dataset.page);
          if (pg) setCurrentPage(pg);
        }
      },
      { root, threshold: [0.2, 0.5, 0.8] }
    );
    pageRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const pageCount = totalPages ?? DEFAULT_PAGES;

  const jump = (dir: 1 | -1) => {
    const next = Math.min(pageCount, Math.max(1, currentPage + dir));
    pageRefs.current[next - 1]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    setCurrentPage(next);
  };

  const jumpToPage = (n: number) => {
    const target = Math.min(pageCount, Math.max(1, n));
    pageRefs.current[target - 1]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    setCurrentPage(target);
  };

  const findingsByPage = React.useMemo(() => {
    const m: Record<number, Finding[]> = {};
    for (const f of findings) {
      const p = f.bbox_page ?? 1;
      (m[p] ??= []).push(f);
    }
    return m;
  }, [findings]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      <PdfToolbar
        title={paperTitle}
        page={currentPage}
        totalPages={pageCount}
        zoom={zoom}
        onZoom={setZoom}
        onJump={jump}
      />
      <PageStrip
        totalPages={pageCount}
        segments={segments}
        findings={findings}
        currentPage={currentPage}
        onPageClick={jumpToPage}
        onSkipSegment={onSkipSegment}
      />
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-y-auto px-6 py-6"
      >
        <div
          className="mx-auto flex flex-col items-center gap-6"
          style={{ width: PAGE_W * zoom }}
        >
          {Array.from({ length: pageCount }).map((_, i) => (
            <PdfPage
              key={i}
              ref={(el) => {
                pageRefs.current[i] = el;
              }}
              page={i + 1}
              zoom={zoom}
              paperTitle={paperTitle}
              findings={findingsByPage[i + 1] ?? []}
              selectedFindingId={selectedFindingId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const PdfPage = React.forwardRef<
  HTMLDivElement,
  {
    page: number;
    zoom: number;
    paperTitle: string;
    findings: Finding[];
    selectedFindingId: string | null;
  }
>(({ page, zoom, paperTitle, findings, selectedFindingId }, ref) => {
  return (
    <div
      ref={ref}
      data-page={page}
      className="relative overflow-hidden rounded-sm border border-border bg-white text-black shadow-md"
      style={{
        width: PAGE_W * zoom,
        height: PAGE_H * zoom,
      }}
    >
      <div
        className="absolute inset-0"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: "top left",
          width: PAGE_W,
          height: PAGE_H,
        }}
      >
        <div className="px-16 pt-10 pb-6 font-serif text-[9.5pt] leading-snug text-neutral-500">
          {paperTitle}
          <span className="float-right">{page}</span>
        </div>
        <div className="px-16 pt-1 font-serif text-[10.5pt] leading-relaxed text-neutral-900">
          <SyntheticPageContent page={page} />
        </div>

        {findings.map((f) => (
          <EvidenceCallout
            key={f.id}
            finding={f}
            active={selectedFindingId === f.id}
          />
        ))}
      </div>
    </div>
  );
});
PdfPage.displayName = "PdfPage";

/**
 * Renders a finding's evidence quote AT its bbox coordinates, styled as
 * paper body text. The surrounding box is the severity-colored highlight.
 * This way the bbox is never visually empty — it always contains the
 * quoted text it refers to.
 */
function EvidenceCallout({
  finding,
  active,
}: {
  finding: Finding;
  active: boolean;
}) {
  if (!finding.bbox) return null;
  if (finding.localize_status === "dropped") return null;

  const { x, y, width, height } = finding.bbox;
  const pending = finding.localize_status === "pending";
  const severityVar = `var(--severity-${finding.severity})`;

  return (
    <motion.div
      initial={false}
      animate={{
        opacity: 1,
        scale: active ? 1.01 : 1,
      }}
      transition={{ duration: 0.2 }}
      className={cn(
        "absolute rounded-sm font-serif text-[10.5pt] leading-relaxed text-neutral-900",
        "flex items-center"
      )}
      style={{
        left: x,
        top: y,
        width,
        minHeight: height,
        padding: "6px 10px",
        border: `${active ? 2.5 : 2}px ${pending ? "dashed" : "solid"} ${severityVar}`,
        backgroundColor: active
          ? "rgba(247, 215, 82, 0.55)"
          : "rgba(247, 215, 82, 0.32)",
        boxShadow: active
          ? `0 0 0 3px color-mix(in oklch, ${severityVar} 22%, transparent)`
          : undefined,
      }}
    >
      <span className="block w-full overflow-hidden">
        <Formula tex={finding.evidence_quote} />
      </span>
      {active && (
        <motion.span
          initial={{ opacity: 0.5, scale: 1 }}
          animate={{ opacity: 0, scale: 1.12 }}
          transition={{ duration: 1, ease: "easeOut" }}
          className="pointer-events-none absolute inset-0 rounded-sm"
          style={{ border: `2px solid ${severityVar}` }}
        />
      )}
    </motion.div>
  );
}

function PdfToolbar({
  title,
  page,
  totalPages,
  zoom,
  onZoom,
  onJump,
}: {
  title: string;
  page: number;
  totalPages: number;
  zoom: number;
  onZoom: (z: number) => void;
  onJump: (dir: 1 | -1) => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur">
      <div className="flex items-center gap-1.5 truncate">
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs text-muted-foreground">{title}</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onJump(-1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-3.5" />
        </Button>
        <span className="min-w-[3rem] text-center text-xs tabular-nums">
          {page} / {totalPages}
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onJump(1)}
          aria-label="Next page"
        >
          <ChevronRight className="size-3.5" />
        </Button>
        <span className="mx-2 h-4 w-px bg-border" />
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onZoom(Math.max(0.5, zoom - 0.1))}
          aria-label="Zoom out"
        >
          <Minus className="size-3.5" />
        </Button>
        <span className="min-w-[3rem] text-center text-xs tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onZoom(Math.min(2, zoom + 0.1))}
          aria-label="Zoom in"
        >
          <Plus className="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={() => onZoom(0.95)}
          aria-label="Fit width"
        >
          <Maximize2 className="size-3.5" />
        </Button>
      </div>
      <div className="hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex">
        <Ruler className="size-3" /> synthetic preview
      </div>
    </div>
  );
}

/**
 * Synthetic page body — prose surrounding the findings. Evidence quotes
 * (the actual flagged formulas) are rendered separately via EvidenceCallout
 * at bbox coordinates, so the bbox is never empty.
 */
function SyntheticPageContent({ page }: { page: number }) {
  if (page === 1) {
    return (
      <div className="space-y-3 text-center">
        <div className="pt-10" />
        <h1 className="font-serif text-[16pt] font-semibold leading-tight">
          Sharp Concentration for a Telescoped Estimator
        </h1>
        <div className="text-[10pt] text-neutral-600">
          Anonymous · Submitted for peer review
        </div>
        <div className="pt-6 text-left">
          <h3 className="font-serif text-[11pt] font-semibold">Abstract</h3>
          <p className="mt-1 text-justify text-[10pt] leading-relaxed">
            We study the concentration of a telescoped estimator under bounded
            i.i.d. sampling. The main theorem establishes a sub-Gaussian tail
            with an explicit constant. Section 3 extends the argument to
            martingale differences, and Corollary 1 derives a consistency
            statement. Our contribution is a sharper constant than previously
            known, obtained via a careful bound on the variance term.
          </p>
          <h3 className="mt-5 font-serif text-[11pt] font-semibold">
            1. Introduction
          </h3>
          <p className="mt-1 text-justify text-[10pt] leading-relaxed text-neutral-700">
            The study of concentration inequalities has a long history in
            probability theory and its statistical applications. Hoeffding&apos;s
            inequality and its refinements provide tools for bounding sample
            averages, while martingale techniques extend these results to
            dependent data. In this note we revisit a classical telescoping
            argument and sharpen the resulting bound.
          </p>
        </div>
      </div>
    );
  }

  const prose: Record<number, Array<{ head?: string; statement?: string; text?: string }>> = {
    2: [
      {
        head: "Lemma 1.",
        statement:
          "For all integers $n \\ge 1$, the telescoping sum satisfies the identity stated below.",
      },
      {
        text: "The proof proceeds by induction. The base case $n = 1$ is immediate. Assuming the claim for $n - 1$, we add the $n$-th term and collect terms, which yields the stated form.",
      },
      {
        head: "Remark 1.",
        statement:
          "The closed form extends naturally to weighted partial sums; see Remark 3 for the variance-weighted variant.",
      },
    ],
    3: [
      {
        head: "Theorem 1.",
        statement:
          "Let $\\{X_i\\}_{i=1}^{n}$ be i.i.d. with mean zero and bounded support. Define $T_n = \\sum_{i=1}^{n} X_i / \\sqrt{n}$. The following bound holds under the stated assumptions.",
      },
      {
        text: "Proof. We apply the telescoping identity of Lemma 1 together with a second-moment bound on the summands.",
      },
      {
        text: "The remainder follows by a standard Chebyshev argument and an application of optional stopping.",
      },
    ],
    4: [
      {
        head: "Lemma 2 (concentration).",
        statement:
          "Let $X_1,\\dots,X_n$ be i.i.d. bounded in $[0,1]$ with mean $\\mu$. Then for any $\\varepsilon > 0$, the following tail bound holds.",
      },
      {
        text: "The proof adapts the moment generating function argument of Hoeffding (1963). We verify the sub-Gaussian condition via a uniform bound on the cumulant function and then apply Markov's inequality.",
      },
    ],
    5: [
      {
        head: "Corollary 1 (consistency).",
        statement:
          "Under the hypotheses of Theorem 1, the sequence $\\{X_n\\}$ converges in probability to $X$.",
      },
      {
        text: "The conclusion follows by combining Lemma 2 with a union bound across the dyadic scales.",
      },
      {
        text: "This result will be used in Section 4 to establish the asymptotic normality of the debiased estimator.",
      },
    ],
  };

  const page_prose = prose[page] ?? [];
  return (
    <div className="space-y-4 pt-2">
      {page_prose.map((p, i) => (
        <div key={i} className="space-y-1.5">
          {p.head && (
            <p>
              <strong className="font-semibold">{p.head}</strong>{" "}
              <em className="italic text-neutral-700">
                <MathText text={p.statement ?? ""} />
              </em>
            </p>
          )}
          {p.text && (
            <p className="text-justify leading-relaxed">
              <MathText text={p.text} />
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
