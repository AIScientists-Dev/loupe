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
import { useQuoteRects, type QuoteRect } from "@/lib/hooks/use-quote-rects";
import type { Bbox, Finding, Segment } from "@/lib/types";

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
  placementTarget,
  onPlaceFinding,
  onPlacementCancel,
  onSelectFinding,
  onReplacePlacement,
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
  /** When non-null, the viewer enters crosshair mode for this finding id. */
  placementTarget?: { findingId: string } | null;
  /** Called when the user drags a rectangle in placement mode. */
  onPlaceFinding?: (findingId: string, page: number, bbox: Bbox) => void;
  /** Called when the user Escs out of placement mode. */
  onPlacementCancel?: () => void;
  /** Called when the user clicks the "see panel" pill for a not_located finding. */
  onSelectFinding?: (findingId: string) => void;
  /** Start a new placement for a finding that already has a bbox. */
  onReplacePlacement?: (findingId: string) => void;
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
        // Top-left origin (MinerU convention); no Y flip.
        const cssTop = selected.bbox.y * scale;
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
      if (
        f.localize_status === "not_located" ||
        f.localize_status === "quote_unverified" ||
        f.localize_status === "dropped"
      )
        continue;
      (m[p] ??= []).push(f);
    }
    return m;
  }, [findings]);

  // Findings that belong to a page but aren't drawn as a rect: not_located /
  // quote_unverified. The page-top pill points users at the panel.
  const unpinnedByPage = React.useMemo(() => {
    const m: Record<number, Finding[]> = {};
    for (const f of findings) {
      if (
        f.localize_status !== "not_located" &&
        f.localize_status !== "quote_unverified"
      )
        continue;
      const p = f.bbox?.page ?? f.bbox_page ?? f.page ?? null;
      if (p == null) continue;
      (m[p] ??= []).push(f);
    }
    return m;
  }, [findings]);

  // Esc cancels an active placement.
  React.useEffect(() => {
    if (!placementTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onPlacementCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placementTarget, onPlacementCancel]);

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
                      renderTextLayer={true}
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
                    {/* Page-top pill: findings that we know live on this
                        page but couldn't pin (not_located, quote_unverified).
                        Sits above any overlays so it's always clickable. */}
                    {(unpinnedByPage[pageNum] ?? []).length > 0 && (
                      <div className="absolute left-1/2 top-1 z-20 -translate-x-1/2">
                        <button
                          onClick={() => {
                            const first = (unpinnedByPage[pageNum] ?? [])[0];
                            if (first && onSelectFinding) onSelectFinding(first.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-50/95 px-2 py-0.5 text-[11px] font-medium text-amber-900 shadow-sm hover:bg-amber-100"
                        >
                          {(unpinnedByPage[pageNum] ?? []).length} finding
                          {(unpinnedByPage[pageNum] ?? []).length === 1 ? "" : "s"} on
                          this page — see panel
                        </button>
                      </div>
                    )}
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
                          pageEl={pageRefs.current[i] ?? null}
                          pageHeight={size.height}
                          scale={scale}
                          active={selectedFindingId === f.id}
                          onReopen={onReopenFinding}
                          onReplace={onReplacePlacement}
                        />
                      ))}
                    </div>
                    {/* Crosshair-mode overlay for manual placement. Lives
                        at page level so coords map to this page's PDF rect. */}
                    {placementTarget && (
                      <PlacementOverlay
                        pageEl={pageRefs.current[i] ?? null}
                        pageNumber={pageNum}
                        pageSize={size}
                        scale={scale}
                        onCommit={(bbox) => {
                          onPlaceFinding?.(placementTarget.findingId, pageNum, bbox);
                        }}
                        onCancel={() => onPlacementCancel?.()}
                      />
                    )}
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

// Left-margin stripe rendering (replaces the bbox-based highlight).
//
// Y-range comes from the text-layer match when possible (pixel-accurate);
// falls back to the page_map block bbox. Severity color. Active stripe is
// wider with a soft glow. Chip anchored next to the stripe top.

const STRIPE_X = 18;       // in PDF points, left-margin anchor
const STRIPE_WIDTH = 4;    // default stripe thickness
const STRIPE_WIDTH_ACTIVE = 7;
const STRIPE_MIN_HEIGHT = 14;

function EvidenceCallout({
  finding,
  pageEl,
  pageHeight,
  scale,
  active,
  onReopen,
  onReplace,
}: {
  finding: Finding;
  pageEl: HTMLElement | null;
  pageHeight: number;
  scale: number;
  active: boolean;
  onReopen?: (id: string) => void;
  onReplace?: (id: string) => void;
}) {
  const quoteRects = useQuoteRects({
    pageEl,
    quote: finding.evidence_quote,
    scale,
    enabled:
      finding.localize_status === "done" || finding.localize_status === "approximate",
  });

  if (finding.localize_status === "dropped") return null;
  if (finding.localize_status === "not_located") return null;
  if (finding.localize_status === "quote_unverified") return null;

  // Derive the stripe's y-range. Prefer text-layer rects (pixel-accurate).
  // Fall back to the bbox the backend gave us.
  let yTop: number | null = null;
  let yBottom: number | null = null;
  if (quoteRects.length > 0) {
    yTop = Math.min(...quoteRects.map((r) => r.y));
    yBottom = Math.max(...quoteRects.map((r) => r.y + r.height));
  } else if (finding.bbox) {
    yTop = Math.max(0, finding.bbox.y);
    yBottom = yTop + Math.max(finding.bbox.height, STRIPE_MIN_HEIGHT);
  }
  if (yTop === null || yBottom === null) return null;

  const stripeHeight = Math.max(STRIPE_MIN_HEIGHT, yBottom - yTop);
  const approximate = finding.localize_status === "approximate";
  const userPlaced = finding.localize_status === "user_placed";
  const pending = finding.localize_status === "pending";
  const decided = finding.decision;
  const severityVar = `var(--severity-${finding.severity})`;

  const width = active ? STRIPE_WIDTH_ACTIVE : STRIPE_WIDTH;

  // Color priority: decided state > severity. Decided findings get the
  // agree/dismiss palette; otherwise severity color.
  let stripeColor = severityVar;
  let decidedLabel: string | null = null;
  if (decided) {
    const c = DECISION_COLORS[decided];
    stripeColor = c.border;
    decidedLabel = decided === "agree" ? "Agreed" : "Dismissed";
  }

  const borderColor = stripeColor;
  const stripeStyle: React.CSSProperties = {
    left: STRIPE_X,
    top: yTop,
    width,
    height: stripeHeight,
    backgroundColor: stripeColor,
    borderRadius: 2,
    boxShadow: active
      ? `0 0 0 4px color-mix(in oklch, ${stripeColor} 22%, transparent)`
      : undefined,
    opacity: approximate ? 0.75 : pending ? 0.55 : 1,
  };

  // Approximate/pending stripes use a dashed-looking pattern via background-image.
  if (approximate || pending) {
    stripeStyle.backgroundImage = `repeating-linear-gradient(to bottom, ${stripeColor} 0 4px, transparent 4px 7px)`;
    stripeStyle.backgroundColor = "transparent";
  }

  const chipStyle: React.CSSProperties = {
    left: STRIPE_X + width + 4,
    top: yTop,
    borderColor,
    color: decided ? borderColor : undefined,
  };

  return (
    <>
      <motion.div
        initial={false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.15 }}
        className="absolute"
        style={stripeStyle}
      />
      {(decided || approximate || userPlaced) && (
        <div
          className="pointer-events-auto absolute"
          style={chipStyle}
          onClick={(e) => e.stopPropagation()}
        >
          <span
            className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-0.5 text-[11px] font-medium shadow-sm"
            style={{ borderColor }}
          >
            {decided && (
              <>
                {decided === "agree" ? (
                  <Check className="size-3" />
                ) : (
                  <XIcon className="size-3" />
                )}
                {decidedLabel}
                {onReopen && (
                  <button
                    onClick={() => onReopen(finding.id)}
                    className="ml-1 inline-flex items-center gap-0.5 rounded-sm border border-border/60 bg-muted/40 px-1 py-0.5 text-[10px] font-normal text-foreground/80 transition-colors hover:border-primary/50 hover:text-foreground"
                    title="Reopen and change this decision"
                  >
                    <Undo2 className="size-2.5" /> Reopen
                  </button>
                )}
              </>
            )}
            {!decided && approximate && (
              <span className="text-muted-foreground">approximate location</span>
            )}
            {!decided && userPlaced && (
              <>
                <span className="text-muted-foreground">manually placed</span>
                {onReplace && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onReplace(finding.id);
                    }}
                    className="ml-1 inline-flex items-center gap-0.5 rounded-sm border border-border/60 bg-muted/40 px-1 py-0.5 text-[10px] font-normal text-foreground/80 transition-colors hover:border-primary/50 hover:text-foreground"
                    title="Redraw this stripe"
                  >
                    <Undo2 className="size-2.5" /> Redraw
                  </button>
                )}
              </>
            )}
          </span>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Manual placement crosshair
// ---------------------------------------------------------------------------

function PlacementOverlay({
  pageEl,
  pageNumber,
  pageSize,
  scale,
  onCommit,
  onCancel,
}: {
  pageEl: HTMLElement | null;
  pageNumber: number;
  pageSize: { width: number; height: number };
  scale: number;
  onCommit: (bbox: Bbox) => void;
  onCancel: () => void;
}) {
  const [drag, setDrag] = React.useState<
    | null
    | { startX: number; startY: number; curX: number; curY: number }
  >(null);

  const toPagePoint = React.useCallback(
    (clientX: number, clientY: number) => {
      if (!pageEl) return { x: 0, y: 0 };
      const r = pageEl.getBoundingClientRect();
      const xCss = Math.max(0, Math.min(r.width, clientX - r.left));
      const yCss = Math.max(0, Math.min(r.height, clientY - r.top));
      return { x: xCss / scale, y: yCss / scale };
    },
    [pageEl, scale]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const p = toPagePoint(e.clientX, e.clientY);
    setDrag({ startX: p.x, startY: p.y, curX: p.x, curY: p.y });
  };

  React.useEffect(() => {
    if (!drag) return;
    const onMove = (e: MouseEvent) => {
      const p = toPagePoint(e.clientX, e.clientY);
      setDrag((d) => (d ? { ...d, curX: p.x, curY: p.y } : d));
    };
    const onUp = () => {
      if (!drag) return;
      const x0 = Math.min(drag.startX, drag.curX);
      const y0 = Math.min(drag.startY, drag.curY);
      const x1 = Math.max(drag.startX, drag.curX);
      const y1 = Math.max(drag.startY, drag.curY);
      const cssW = x1 - x0;
      const cssH = y1 - y0;
      setDrag(null);
      if (cssW < 2 || cssH < 2) {
        // treat as mis-click; stay in placement mode
        return;
      }
      // Backend uses top-left origin (MinerU convention). Match it directly.
      const bbox: Bbox = {
        page: pageNumber,
        x: x0,
        y: y0,
        width: cssW,
        height: cssH,
      };
      onCommit(bbox);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag, toPagePoint, pageNumber, pageSize.height, onCommit]);

  const rectStyle = drag
    ? (() => {
        const x0 = Math.min(drag.startX, drag.curX) * scale;
        const y0 = Math.min(drag.startY, drag.curY) * scale;
        const w = Math.abs(drag.curX - drag.startX) * scale;
        const h = Math.abs(drag.curY - drag.startY) * scale;
        return { left: x0, top: y0, width: w, height: h };
      })()
    : null;

  return (
    <div
      className="absolute inset-0 z-30"
      style={{ cursor: "crosshair", background: "rgba(0,0,0,0.02)" }}
      onMouseDown={handleMouseDown}
      onClick={(e) => e.stopPropagation()}
      title="Drag to place this finding — Esc to cancel"
    >
      {rectStyle && (
        <div
          className="absolute rounded-sm border-2 border-amber-500 bg-amber-200/25"
          style={rectStyle}
        />
      )}
      <div className="pointer-events-none absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-amber-500 px-2 py-0.5 text-[11px] font-medium text-white shadow">
        Drag a box over the finding · Esc to cancel
      </div>
    </div>
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
