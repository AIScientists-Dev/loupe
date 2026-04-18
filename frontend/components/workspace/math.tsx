"use client";

import * as React from "react";
import katex from "katex";
import "katex/dist/katex.min.css";

import { cn } from "@/lib/utils";

/**
 * Renders a KaTeX expression. Wrap arbitrary text containing $...$ with
 * <MathInline> inside, or pass raw TeX as the children.
 */
export function Formula({
  tex,
  block = false,
  className,
}: {
  tex: string;
  block?: boolean;
  className?: string;
}) {
  const html = React.useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: block,
        throwOnError: false,
        output: "html",
      });
    } catch {
      return `<span>${tex}</span>`;
    }
  }, [tex, block]);

  return (
    <span
      className={cn(block && "my-1 block", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * Renders a string that may contain $...$ (inline) and $$...$$ (block) math
 * segments mixed with plain text.
 */
export function MathText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const parts = React.useMemo(() => splitMath(text), [text]);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.kind === "text" ? (
          <React.Fragment key={i}>{p.value}</React.Fragment>
        ) : (
          <Formula key={i} tex={p.value} block={p.kind === "block"} />
        )
      )}
    </span>
  );
}

type Segment = { kind: "text" | "inline" | "block"; value: string };

function splitMath(input: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < input.length) {
    // Block math $$...$$
    if (input.startsWith("$$", i)) {
      const end = input.indexOf("$$", i + 2);
      if (end === -1) {
        out.push({ kind: "text", value: input.slice(i) });
        break;
      }
      out.push({ kind: "block", value: input.slice(i + 2, end) });
      i = end + 2;
      continue;
    }
    // Inline math $...$
    if (input[i] === "$") {
      const end = input.indexOf("$", i + 1);
      if (end === -1) {
        out.push({ kind: "text", value: input.slice(i) });
        break;
      }
      out.push({ kind: "inline", value: input.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    // Plain text until next $
    const next = input.indexOf("$", i);
    const stop = next === -1 ? input.length : next;
    out.push({ kind: "text", value: input.slice(i, stop) });
    i = stop;
  }
  return out.filter((s) => s.value !== "");
}
