"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
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
import { MathText } from "./math";
import { SEVERITY_META } from "./issue-type";
import type { Finding } from "@/lib/types";

const PAGE_W = 612; // PDF points, US letter
const PAGE_H = 792;
const TOTAL_PAGES = 5;

export function PdfViewer({
  paperTitle,
  findings,
  selectedFindingId,
  onPageChange,
}: {
  paperTitle: string;
  findings: Finding[];
  selectedFindingId: string | null;
  onPageChange?: (page: number) => void;
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
      onPageChange?.(selected.bbox_page);
    }
  }, [selectedFindingId, selected, onPageChange]);

  // Track current page on scroll.
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

  const jump = (dir: 1 | -1) => {
    const next = Math.min(TOTAL_PAGES, Math.max(1, currentPage + dir));
    pageRefs.current[next - 1]?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
    setCurrentPage(next);
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
    <div className="flex h-full flex-col bg-muted/30">
      <PdfToolbar
        title={paperTitle}
        page={currentPage}
        zoom={zoom}
        onZoom={setZoom}
        onJump={jump}
      />
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto px-6 py-6"
      >
        <div
          className="mx-auto flex flex-col items-center gap-6"
          style={{ width: PAGE_W * zoom }}
        >
          {Array.from({ length: TOTAL_PAGES }).map((_, i) => (
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
      {/* Fake page chrome */}
      <div
        className="absolute inset-0"
        style={{ transform: `scale(${zoom})`, transformOrigin: "top left", width: PAGE_W, height: PAGE_H }}
      >
        <div className="px-16 pt-10 pb-6 font-serif text-[9.5pt] leading-snug text-neutral-500">
          {paperTitle}
          <span className="float-right">{page}</span>
        </div>
        <div className="px-16 pt-1 font-serif text-[10.5pt] leading-relaxed text-neutral-900">
          <SyntheticPageContent page={page} findings={findings} />
        </div>

        {/* Bbox overlays */}
        {findings.map((f) => (
          <BboxOverlay
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

function BboxOverlay({ finding, active }: { finding: Finding; active: boolean }) {
  if (!finding.bbox) return null;
  const { x, y, width, height } = finding.bbox;
  const sev = SEVERITY_META[finding.severity];
  const pending = finding.localize_status === "pending";
  const dropped = finding.localize_status === "dropped";

  if (dropped) return null;

  const [ping, setPing] = React.useState(active);
  React.useEffect(() => {
    if (!active) return;
    setPing(true);
    const t = setTimeout(() => setPing(false), 1600);
    return () => clearTimeout(t);
  }, [active, finding.id]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: active ? 1 : 0.8 }}
      className={cn(
        "absolute rounded-sm transition-all",
        pending && "border-2 border-dashed animate-shimmer",
        !pending && "border-2 border-solid",
        active ? "ring-2 ring-offset-0" : "",
      )}
      style={{
        left: x,
        top: y,
        width,
        height,
        borderColor: `var(--severity-${finding.severity})`,
        backgroundColor: active
          ? "var(--highlight)"
          : pending
            ? "var(--highlight)"
            : "transparent",
        mixBlendMode: "multiply",
        opacity: active ? 0.55 : pending ? 0.3 : 0.7,
        ...(active
          ? {
              boxShadow: `0 0 0 3px var(--severity-${finding.severity})`,
            }
          : {}),
      }}
    >
      {ping && (
        <motion.span
          initial={{ scale: 1, opacity: 0.6 }}
          animate={{ scale: 1.15, opacity: 0 }}
          transition={{ duration: 1.2, ease: "easeOut" }}
          className="absolute inset-0 rounded-sm"
          style={{ border: `2px solid var(--severity-${finding.severity})` }}
        />
      )}
    </motion.div>
  );
}

function PdfToolbar({
  title,
  page,
  zoom,
  onZoom,
  onJump,
}: {
  title: string;
  page: number;
  zoom: number;
  onZoom: (z: number) => void;
  onJump: (dir: 1 | -1) => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur">
      <div className="flex items-center gap-1.5">
        <FileText className="size-3.5 text-muted-foreground" />
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
          {page} / {TOTAL_PAGES}
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
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Ruler className="size-3" /> synthetic preview
      </div>
    </div>
  );
}

/**
 * Minimal "paper-like" page content so each page reads as academic prose.
 * Real integration (react-pdf + backend-served PDF) swaps this at
 * component-boundary without changing surrounding layout.
 */
function SyntheticPageContent({
  page,
  findings,
}: {
  page: number;
  findings: Finding[];
}) {
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
            probability theory and its statistical applications. Hoeffding's
            inequality and its refinements provide tools for bounding sample
            averages, while martingale techniques extend these results to
            dependent data. In this note we revisit a classical telescoping
            argument and sharpen the resulting bound.
          </p>
        </div>
      </div>
    );
  }

  // Pages 2–5: render fake proof blocks and let bbox overlays land on top.
  const blocks: Record<number, { head: string; statement: string; body: string[] }[]> = {
    2: [
      {
        head: "Lemma 1.",
        statement: "For all integers n \\ge 1, the telescoping sum satisfies",
        body: [
          "$$\\sum_{i=1}^{n} i = \\tfrac{n^2}{2}, \\text{ hence } S_n \\le \\tfrac{n^2}{2}.$$",
          "The proof proceeds by induction. The base case $n=1$ is immediate. Assuming the claim for $n-1$, we add the $n$-th term and collect terms, which yields the stated form.",
        ],
      },
      {
        head: "Remark 1.",
        statement:
          "The closed form extends naturally to weighted partial sums; see Remark 3 for the variance-weighted variant.",
        body: [],
      },
    ],
    3: [
      {
        head: "Theorem 1.",
        statement:
          "Let $\\{X_i\\}_{i=1}^{n}$ be i.i.d. with mean zero and bounded support. Define $T_n = \\sum_{i=1}^{n} X_i / \\sqrt{n}$. Then",
        body: [
          "$$\\text{Since } T_n \\ge C\\sqrt{n}, \\text{ we conclude } T_n \\le C\\sqrt{n}.$$",
          "Proof. We apply the telescoping identity of Lemma 1 together with a second-moment bound on the summands.",
          "\\text{By Assumption A3, the martingale difference sequence satisfies } |d_i| \\le \\sigma \\text{ almost surely.}",
          "The remainder follows by a standard Chebyshev argument and optional stopping.",
        ],
      },
    ],
    4: [
      {
        head: "Lemma 2 (concentration).",
        statement:
          "Let $X_1,\\dots,X_n$ be i.i.d. bounded in $[0,1]$ with mean $\\mu$. Then for any $\\varepsilon > 0$,",
        body: [
          "$$P\\!\\left(|\\bar X_n - \\mu| \\ge \\varepsilon\\right) \\le 2\\exp(-n\\varepsilon).$$",
          "The proof adapts the moment generating function argument of Hoeffding (1963). We verify the sub-Gaussian condition via a uniform bound on the cumulant function and then apply Markov's inequality.",
        ],
      },
    ],
    5: [
      {
        head: "Corollary 1 (consistency).",
        statement:
          "Under the hypotheses of Theorem 1, the sequence $\\{X_n\\}$ converges in probability to $X$, i.e.",
        body: [
          "$$\\exists\\, \\delta > 0 \\;\\text{ such that }\\; \\forall\\, \\varepsilon > 0,\\; P(|X_n - X| < \\delta) \\ge 1 - \\varepsilon.$$",
          "The conclusion follows by combining Lemma 2 with a union bound across the dyadic scales.",
          "This result will be used in Section 4 to establish the asymptotic normality of the debiased estimator.",
        ],
      },
    ],
  };

  const pageBlocks = blocks[page] ?? [];
  return (
    <div className="space-y-4 pt-2">
      {pageBlocks.map((b, i) => (
        <div key={i} className="space-y-1.5">
          <p>
            <strong className="font-semibold">{b.head}</strong>{" "}
            <em className="italic text-neutral-700">
              <MathText text={b.statement} />
            </em>
          </p>
          {b.body.map((line, j) => (
            <div key={j} className="text-justify leading-relaxed">
              <MathText text={line} />
            </div>
          ))}
        </div>
      ))}
      {pageBlocks.length === 0 && (
        <p className="text-neutral-500">(Figure or blank space)</p>
      )}
    </div>
  );
}
