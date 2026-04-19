"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Document, Page, Thumbnail, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Maximize2,
  Ruler,
  FileText,
  Loader2,
  PanelLeft,
  PanelLeftClose,
  SkipForward,
  Check,
  X as XIcon,
  Undo2,
  Download,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Finding, Segment } from "@/lib/types";

pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

const PAGE_W = 612;
const PAGE_H = 792;
const THUMB_MIN = 80;
const THUMB_MAX = 220;
const THUMB_DEFAULT = 120;
const THUMBS_KEY = "loupe.thumbs.open";
const THUMB_SIZE_KEY = "loupe.thumbs.size";

export function PdfViewer({
  paperId,
  paperTitle,
  findings,
  selectedFindingId,
  segments,
  totalPages,
  onSkipSegment,
  onReopenFinding,
}: {
  paperId: string;
  paperTitle: string;
  findings: Finding[];
  segments?: Segment[];
  totalPages?: number;
  selectedFindingId: string | null;
  onSkipSegment?: (segmentId: string) => void;
  /** Click handler for the Reopen button on a decided bbox. */
  onReopenFinding?: (id: string) => void;
}) {
  const [zoom, setZoom] = React.useState(1);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [numPages, setNumPages] = React.useState<number | null>(totalPages ?? null);
  const [pageSizes, setPageSizes] = React.useState<
    Record<number, { width: number; height: number }>
  >({});
  const [thumbsOpen, setThumbsOpen] = React.useState(false);
  const [thumbSize, setThumbSize] = React.useState(THUMB_DEFAULT);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const pageRefs = React.useRef<Array<HTMLDivElement | null>>([]);

  // Trackpad pinch comes through as wheel events with ctrlKey=true.
  // cmd-scroll on Mac gives metaKey=true. Both map to zoom.
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      // deltaY > 0 means pinch-in / scroll-down → zoom out.
      const delta = -e.deltaY * 0.003;
      setZoom((z) => Math.min(2, Math.max(0.5, +(z + delta).toFixed(2))));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Track native fullscreen state so the button label reflects reality.
  React.useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = React.useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    } else {
      el.requestFullscreen().catch(() => undefined);
    }
  }, []);

  React.useEffect(() => {
    try {
      const open = localStorage.getItem(THUMBS_KEY);
      if (open === "1") setThumbsOpen(true);
      const size = Number(localStorage.getItem(THUMB_SIZE_KEY));
      if (size >= THUMB_MIN && size <= THUMB_MAX) setThumbSize(size);
    } catch {}
  }, []);

  const pdfUrl = React.useMemo(() => api.pdfUrl(paperId), [paperId]);

  const pageCount = numPages ?? totalPages ?? 0;

  const selected = findings.find((f) => f.id === selectedFindingId);
  React.useEffect(() => {
    if (!selected) return;
    const pg = selected.bbox?.page ?? selected.bbox_page;
    if (!pg) return;
    const root = containerRef.current;
    const target = pageRefs.current[pg - 1];
    if (!root || !target) return;
    // offsetTop walks to the nearest positioned ancestor, which isn't
    // always the scroll container. Use viewport rects instead.
    const rootRect = root.getBoundingClientRect();
    const pageRect = target.getBoundingClientRect();
    const pageTopInScroll = pageRect.top - rootRect.top + root.scrollTop;
    let scrollTo = pageTopInScroll;
    // If we have the bbox and page dimensions, scroll so the bbox sits
    // near the top of the viewport (with a small header margin) — not the
    // top of the page. This is what "navigate to the box" actually means.
    if (selected.bbox) {
      const size = pageSizes[pg];
      if (size && size.width > 0) {
        const scale = target.clientWidth / size.width;
        const cssTop = (size.height - selected.bbox.y - selected.bbox.height) * scale;
        scrollTo = pageTopInScroll + cssTop - 96;
      }
    }
    root.scrollTo({ top: Math.max(0, scrollTo), behavior: "smooth" });
    setCurrentPage(pg);
  }, [selectedFindingId, pageSizes]);

  React.useEffect(() => {
    const root = containerRef.current;
    if (!root || pageCount === 0) return;
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
      { root, threshold: [0.1, 0.25, 0.5, 0.75] }
    );
    pageRefs.current.forEach((el) => el && observer.observe(el));
    return () => observer.disconnect();
  }, [pageCount]);

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
      const p = f.bbox?.page ?? f.bbox_page ?? null;
      if (p == null) continue;
      (m[p] ??= []).push(f);
    }
    return m;
  }, [findings]);

  const pendingSegments = React.useMemo(
    () => (segments ?? []).filter((s) => s.status === "pending"),
    [segments]
  );

  const baseWidth = PAGE_W * zoom;

  const toggleThumbs = () => {
    setThumbsOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(THUMBS_KEY, next ? "1" : "0");
      } catch {}
      return next;
    });
  };

  const updateThumbSize = (n: number) => {
    const clamped = Math.min(THUMB_MAX, Math.max(THUMB_MIN, n));
    setThumbSize(clamped);
    try {
      localStorage.setItem(THUMB_SIZE_KEY, String(clamped));
    } catch {}
  };

  return (
    <div
      ref={rootRef}
      className="relative flex h-full min-h-0 flex-col bg-muted/30"
    >
      <PdfToolbar
        title={paperTitle}
        page={currentPage}
        totalPages={pageCount}
        zoom={zoom}
        onZoom={setZoom}
        onJump={jump}
        thumbsOpen={thumbsOpen}
        onToggleThumbs={toggleThumbs}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        paperId={paperId}
      />
      {/* Floating zoom pill, only in fullscreen. High contrast so it's
          obvious against any PDF page color, mouse-reachable without
          travelling to the top toolbar. */}
      {isFullscreen && (
        <div className="pointer-events-auto fixed bottom-6 right-6 z-50 flex items-center gap-1 rounded-full border border-border bg-background/95 px-2 py-1 shadow-lg backdrop-blur">
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}
            aria-label="Zoom out"
          >
            <Minus className="size-4" />
          </Button>
          <span className="min-w-[3rem] text-center text-xs font-medium tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))}
            aria-label="Zoom in"
          >
            <Plus className="size-4" />
          </Button>
          <span className="mx-1 h-4 w-px bg-border" />
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setZoom(1)}
            aria-label="Reset zoom"
            title="Reset zoom to 100%"
          >
            <Ruler className="size-3.5" />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={toggleFullscreen}
            aria-label="Exit fullscreen"
            title="Exit fullscreen"
          >
            <XIcon className="size-4" />
          </Button>
        </div>
      )}
      {onSkipSegment && pendingSegments.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border/60 bg-background/50 px-4 py-1.5 text-[11px]">
          <span className="shrink-0 font-semibold uppercase tracking-wider text-muted-foreground">
            Skip
          </span>
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {pendingSegments.map((seg) => (
              <button
                key={seg.segment_id}
                onClick={() => onSkipSegment(seg.segment_id)}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-0.5 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                title={`Don't analyze ${seg.label} (pages ${seg.page_start}–${seg.page_end})`}
              >
                <SkipForward className="size-3" />
                {seg.label} · p.{seg.page_start}–{seg.page_end}
              </button>
            ))}
          </div>
        </div>
      )}
      <Document
        file={pdfUrl}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        loading={
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> Loading PDF…
          </div>
        }
        error={
          <div className="mx-auto mt-10 max-w-md rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            Could not load PDF. The backend may not yet have the file available.
          </div>
        }
        className="flex min-h-0 flex-1"
      >
        <AnimatePresence initial={false}>
          {thumbsOpen && pageCount > 0 && (
            // The aside width is FIXED (always sized for THUMB_MAX) so the
            // slider below it stays put as you drag. Only the thumbnail
            // images inside this panel scale with `thumbSize`.
            <motion.aside
              key="thumbs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ width: THUMB_MAX + 48 }}
              className="relative flex shrink-0 flex-col overflow-hidden border-r border-border bg-background/70"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
                <span className="font-semibold uppercase tracking-wider">
                  Pages
                </span>
                <input
                  type="range"
                  min={THUMB_MIN}
                  max={THUMB_MAX}
                  value={thumbSize}
                  onChange={(e) => updateThumbSize(Number(e.target.value))}
                  className="h-1 w-20 cursor-pointer accent-primary"
                  aria-label="Thumbnail size"
                />
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-3">
                <div className="flex flex-col items-center gap-3">
                  {Array.from({ length: pageCount }).map((_, i) => {
                    const pageNum = i + 1;
                    const hasFinding = (findingsByPage[pageNum]?.length ?? 0) > 0;
                    const active = pageNum === currentPage;
                    return (
                      <button
                        key={pageNum}
                        onClick={() => jumpToPage(pageNum)}
                        className={cn(
                          "group flex flex-col items-center gap-1 rounded-md p-1 transition-colors",
                          active
                            ? "bg-primary/10 ring-2 ring-primary/60"
                            : "hover:bg-muted"
                        )}
                        aria-label={`Page ${pageNum}`}
                      >
                        <div
                          className={cn(
                            "relative overflow-hidden rounded-sm border bg-white shadow-sm",
                            active ? "border-primary" : "border-border/70"
                          )}
                          style={{ width: thumbSize }}
                        >
                          <Thumbnail
                            pageNumber={pageNum}
                            width={thumbSize}
                            loading={
                              <div
                                className="flex items-center justify-center bg-muted"
                                style={{ width: thumbSize, height: thumbSize * 1.29 }}
                              />
                            }
                          />
                          {hasFinding && (
                            <span
                              className="absolute right-1 top-1 size-2 rounded-full bg-severity-high"
                              aria-hidden
                            />
                          )}
                        </div>
                        <span
                          className={cn(
                            "text-[10px] tabular-nums",
                            active ? "font-semibold text-foreground" : "text-muted-foreground"
                          )}
                        >
                          {pageNum}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </motion.aside>
          )}
        </AnimatePresence>
        <div
          ref={containerRef}
          className="min-h-0 flex-1 overflow-y-auto bg-neutral-100 px-6 py-6 dark:bg-neutral-900"
        >
          <div className="mx-auto flex flex-col items-center gap-6">
            {pageCount > 0 &&
              Array.from({ length: pageCount }).map((_, i) => {
                const pageNum = i + 1;
                const size = pageSizes[pageNum] ?? { width: PAGE_W, height: PAGE_H };
                const renderW = baseWidth;
                const scale = renderW / size.width;
                return (
                  <div
                    key={pageNum}
                    ref={(el) => {
                      pageRefs.current[i] = el;
                    }}
                    data-page={pageNum}
                    className="relative overflow-hidden rounded-sm bg-white shadow-md"
                    style={{ width: renderW }}
                  >
                    <Page
                      pageNumber={pageNum}
                      width={renderW}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      onLoadSuccess={(p) => {
                        const w = p.originalWidth ?? p.width;
                        const h = p.originalHeight ?? p.height;
                        setPageSizes((prev) =>
                          prev[pageNum]?.width === w
                            ? prev
                            : { ...prev, [pageNum]: { width: w, height: h } }
                        );
                      }}
                    />
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{
                        transform: `scale(${scale})`,
                        transformOrigin: "top left",
                        width: size.width,
                        height: size.height,
                      }}
                    >
                      {(findingsByPage[pageNum] ?? []).map((f) => (
                        <EvidenceCallout
                          key={f.id}
                          finding={f}
                          pageHeight={size.height}
                          active={selectedFindingId === f.id}
                          onReopen={onReopenFinding}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </Document>
    </div>
  );
}

const DECISION_COLORS = {
  agree: { border: "rgb(34, 197, 94)", bg: "rgba(34, 197, 94, 0.10)" },
  dismiss: { border: "rgb(148, 163, 184)", bg: "rgba(148, 163, 184, 0.08)" },
} as const;

function EvidenceCallout({
  finding,
  pageHeight,
  active,
  onReopen,
}: {
  finding: Finding;
  pageHeight: number;
  active: boolean;
  onReopen?: (id: string) => void;
}) {
  if (!finding.bbox) return null;
  if (finding.localize_status === "dropped") return null;

  const { x, y, width, height } = finding.bbox;
  // PDF-native bbox origin is bottom-left; CSS is top-left. Convert Y.
  const cssTop = Math.max(0, pageHeight - y - height);
  const pending = finding.localize_status === "pending";
  const decided = finding.decision;
  const severityVar = `var(--severity-${finding.severity})`;

  // Decided finding: muted green/gray border and tint, with a small
  // "Processed — Agreed/Dismissed" chip and a Reopen button.
  if (decided) {
    const c = DECISION_COLORS[decided];
    const label = decided === "agree" ? "Agreed" : "Dismissed";
    return (
      <motion.div
        initial={false}
        animate={{ opacity: 1 }}
        className="absolute rounded-sm"
        style={{
          left: x,
          top: cssTop,
          width,
          minHeight: height,
          border: `1.5px solid ${c.border}`,
          backgroundColor: c.bg,
        }}
      >
        <div
          className="pointer-events-auto absolute left-0 top-0 -translate-y-full pr-1 pb-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-1.5 py-0.5 text-[11px] font-medium shadow-sm"
            style={{ borderColor: c.border, color: c.border }}
          >
            {decided === "agree" ? (
              <Check className="size-3" />
            ) : (
              <XIcon className="size-3" />
            )}
            Processed — {label}
            {onReopen && (
              <button
                onClick={() => onReopen(finding.id)}
                className="ml-1 inline-flex items-center gap-0.5 rounded-sm border border-border/60 bg-muted/40 px-1 py-0.5 text-[10px] font-normal text-foreground/80 transition-colors hover:border-primary/50 hover:text-foreground"
                title="Reopen and change this decision"
              >
                <Undo2 className="size-2.5" /> Reopen
              </button>
            )}
          </span>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={false}
      animate={{
        opacity: 1,
        scale: active ? 1.01 : 1,
      }}
      transition={{ duration: 0.2 }}
      className={cn("absolute rounded-sm", active && "pointer-events-auto")}
      style={{
        left: x,
        top: cssTop,
        width,
        minHeight: height,
        border: `${active ? 2.5 : 2}px ${pending ? "dashed" : "solid"} ${severityVar}`,
        backgroundColor: active
          ? "rgba(247, 215, 82, 0.35)"
          : "rgba(247, 215, 82, 0.18)",
        boxShadow: active
          ? `0 0 0 3px color-mix(in oklch, ${severityVar} 22%, transparent)`
          : undefined,
      }}
    >
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
  thumbsOpen,
  onToggleThumbs,
  isFullscreen,
  onToggleFullscreen,
  paperId,
}: {
  title: string;
  page: number;
  totalPages: number;
  zoom: number;
  onZoom: (z: number) => void;
  onJump: (dir: 1 | -1) => void;
  thumbsOpen: boolean;
  onToggleThumbs: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  paperId: string;
}) {
  return (
    // sticky so it stays pinned at the top of the fullscreen viewport
    // (zoom controls remain reachable in fullscreen mode)
    <div className="sticky top-0 z-20 flex h-11 shrink-0 items-center justify-between border-b border-border bg-background/95 px-3 backdrop-blur">
      <div className="flex items-center gap-1 truncate">
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onToggleThumbs}
          aria-label={thumbsOpen ? "Hide page thumbnails" : "Show page thumbnails"}
          aria-pressed={thumbsOpen}
        >
          {thumbsOpen ? (
            <PanelLeftClose className="size-3.5" />
          ) : (
            <PanelLeft className="size-3.5" />
          )}
        </Button>
        <FileText className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
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
          {page} / {totalPages || "…"}
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
          onClick={() => onZoom(1)}
          aria-label="Reset zoom to 100%"
          title="Reset zoom to 100%"
        >
          <Ruler className="size-3.5" />
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
        >
          <Maximize2 className="size-3.5" />
        </Button>
      </div>
      <div className="hidden items-center gap-1 md:flex">
        <a
          href={`/api/v1/papers/${paperId}/pdf-annotated`}
          download
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          title="Download the PDF with red boxes baked in as annotations"
        >
          <Download className="size-3" />
          Download annotated PDF
        </a>
      </div>
    </div>
  );
}
