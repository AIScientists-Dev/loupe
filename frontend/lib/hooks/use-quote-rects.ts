"use client";

import * as React from "react";

/**
 * Find a verbatim (or near-verbatim) substring in the rendered PDF.js text
 * layer and return one rectangle per visual line — the same geometry the
 * browser uses for native text selection. This is the accuracy floor: if
 * the quote appears in the text layer, our highlight will sit pixel-for-pixel
 * where the user's own text selection would.
 *
 * Returns rects in PDF-NATIVE coordinates (points, bottom-left origin
 * remapped to top-left for CSS). The caller's overlay is already
 * transform-scaled, so coords match the existing bbox layer.
 */
export type QuoteRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function useQuoteRects(params: {
  pageEl: HTMLElement | null;
  quote: string;
  scale: number; // renderW / pageSize.width  (CSS px per PDF point)
  enabled?: boolean;
}): QuoteRect[] {
  const { pageEl, quote, scale, enabled = true } = params;
  const [rects, setRects] = React.useState<QuoteRect[]>([]);

  React.useEffect(() => {
    if (!enabled || !pageEl || !quote || !scale) {
      setRects([]);
      return;
    }

    let cancelled = false;

    const attempt = () => {
      if (cancelled) return false;
      const layer = pageEl.querySelector<HTMLElement>(
        ".react-pdf__Page__textContent"
      );
      if (!layer || !layer.firstChild) return false;
      const range = findQuoteRange(layer, quote);
      if (!range) {
        setRects([]);
        return true; // text layer is populated but quote not present — stop trying
      }
      const pageRect = pageEl.getBoundingClientRect();
      const clientRects = Array.from(range.getClientRects()).filter(
        (r) => r.width > 0.5 && r.height > 0.5
      );
      const out: QuoteRect[] = clientRects.map((r) => ({
        x: (r.left - pageRect.left) / scale,
        y: (r.top - pageRect.top) / scale,
        width: r.width / scale,
        height: r.height / scale,
      }));
      setRects(out);
      return true;
    };

    if (attempt()) return;

    // Text layer not yet populated — observe for it.
    const observer = new MutationObserver(() => {
      if (attempt()) observer.disconnect();
    });
    observer.observe(pageEl, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [pageEl, quote, scale, enabled]);

  return rects;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type NodeRange = { node: Text; start: number; end: number };

function findQuoteRange(layer: HTMLElement, quote: string): Range | null {
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT, null);
  const nodes: NodeRange[] = [];
  let concat = "";
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const text = (n as Text).data;
    nodes.push({ node: n as Text, start: concat.length, end: concat.length + text.length });
    concat += text;
    // Insert a space between sibling spans so multi-span words don't collide
    concat += " ";
  }
  if (!concat.trim()) return null;

  // Try tight then loose normalization.
  for (const norm of [normalizeTight, normalizeLoose]) {
    const { text: nText, indexMap } = normalizeWithMap(concat, norm);
    const nq = norm(quote).trim();
    if (!nq) continue;
    const pos = nText.indexOf(nq);
    if (pos < 0) continue;
    const origStart = indexMap[pos];
    const origEndIdx = Math.min(indexMap.length - 1, pos + nq.length - 1);
    const origEnd = indexMap[origEndIdx] + 1;
    const s = locateInNodes(nodes, origStart);
    const e = locateInNodes(nodes, Math.max(origStart, origEnd - 1));
    if (!s || !e) continue;
    const range = document.createRange();
    try {
      range.setStart(s.node, s.offset);
      range.setEnd(e.node, Math.min(e.offset + 1, e.node.data.length));
    } catch {
      continue;
    }
    return range;
  }
  return null;
}

function locateInNodes(nodes: NodeRange[], offset: number): { node: Text; offset: number } | null {
  for (const nr of nodes) {
    if (offset >= nr.start && offset < nr.end) {
      return { node: nr.node, offset: offset - nr.start };
    }
  }
  // Offset fell into a synthetic inter-span space. Return end of previous node.
  const prev = [...nodes].reverse().find((nr) => nr.start <= offset);
  if (!prev) return null;
  return { node: prev.node, offset: Math.max(0, prev.node.data.length - 1) };
}

// Collapse runs of whitespace to a single space. Keep a map from normalized
// index to original index so we can rebuild a Range.
function normalizeWithMap(
  raw: string,
  normalize: (s: string) => string
): { text: string; indexMap: number[] } {
  // Character-by-character: if the current char maps to something in the
  // normalized output, record the original index.
  // We perform normalization as a two-pass process: strip + whitespace-collapse.
  // We do it manually to keep index mapping.
  const mapped: number[] = [];
  let out = "";
  let prevWasSpace = false;
  const stripped = normalize === normalizeLoose ? stripLooseMacros(raw) : raw;
  // stripLooseMacros changes indices; produce a parallel index map from
  // stripped indices to raw indices.
  const strippedToRaw: number[] = raw === stripped ? raw.split("").map((_, i) => i) : buildStripMap(raw);

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    if (/\s/.test(ch)) {
      if (!prevWasSpace && out.length > 0) {
        out += " ";
        mapped.push(strippedToRaw[i] ?? i);
      }
      prevWasSpace = true;
    } else {
      out += ch;
      mapped.push(strippedToRaw[i] ?? i);
      prevWasSpace = false;
    }
  }
  // Trim trailing space
  while (out.endsWith(" ")) {
    out = out.slice(0, -1);
    mapped.pop();
  }
  return { text: out, indexMap: mapped };
}

function buildStripMap(raw: string): number[] {
  // Strip \mathbf{X} → X, etc. Build a mapping from stripped-index → raw-index.
  const out: number[] = [];
  let i = 0;
  while (i < raw.length) {
    const m = raw.slice(i).match(
      /^\\(?:mathbf|mathrm|mathit|mathsf|mathtt|boldsymbol|bm|operatorname)\s*\{([^{}]*)\}/
    );
    if (m) {
      const inner = m[1];
      const openBraceIdx = i + m[0].indexOf("{");
      for (let j = 0; j < inner.length; j++) {
        out.push(openBraceIdx + 1 + j);
      }
      i += m[0].length;
    } else {
      out.push(i);
      i += 1;
    }
  }
  return out;
}

function stripLooseMacros(s: string): string {
  return s.replace(
    /\\(?:mathbf|mathrm|mathit|mathsf|mathtt|boldsymbol|bm|operatorname)\s*\{([^{}]*)\}/g,
    "$1"
  );
}

function normalizeTight(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizeLoose(s: string): string {
  return stripLooseMacros(s).replace(/\s+/g, " ").trim();
}
