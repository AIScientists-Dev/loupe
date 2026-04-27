"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

import { cn } from "@/lib/utils";

// Italicize bare unicode math characters (Greek letters, arrows, operators)
// outside of $...$ math blocks so prose reads correctly.
const MATH_UNICODE_RE = /([\u0370-\u03FF\u2190-\u21FF\u2200-\u22FF\u00B1\u00D7]+)/;
function rehypeMathUnicodeItalic() {
  function walk(node: any) {
    if (!node.children) return;
    const next: any[] = [];
    for (const child of node.children) {
      if (child.type === "text" && MATH_UNICODE_RE.test(child.value)) {
        const parts = child.value.split(MATH_UNICODE_RE);
        for (const part of parts) {
          if (!part) continue;
          if (MATH_UNICODE_RE.test(part)) {
            next.push({
              type: "element",
              tagName: "i",
              properties: {},
              children: [{ type: "text", value: part }],
            });
          } else {
            next.push({ type: "text", value: part });
          }
        }
      } else {
        walk(child);
        next.push(child);
      }
    }
    node.children = next;
  }
  return (tree: any) => walk(tree);
}

// ASCII names we treat as LaTeX greek letters when they appear as standalone
// words. Skewed toward letters that are unambiguous in technical prose —
// "pi", "eta", "sigma" are almost always math; "xi" and "chi" less so but
// still overwhelmingly math in this app's domain.
const GREEK_NAMES =
  "alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|varpi|rho|varrho|sigma|varsigma|tau|upsilon|phi|varphi|chi|psi|omega|Gamma|Delta|Theta|Lambda|Xi|Pi|Sigma|Upsilon|Phi|Psi|Omega";

// Save existing $...$ and $$...$$ pairs into `saved` and replace with
// placeholders so subsequent rewrites don't descend into already-wrapped
// math. Idempotent: running it again on a string with no fresh pairs is a
// no-op.
function saveMathPairs(s: string, saved: string[]): string {
  return s.replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+?\$/g, (m) => {
    const idx = saved.length;
    saved.push(m);
    return `\x02${idx}\x02`;
  });
}

// Fix greek-letter words and `grad`→\nabla inside content we're about to
// wrap in math delimiters. Called on the INNER of `||...||` so the norm
// renders as \|\nabla f(x_t)\|^2 rather than \|grad f(x_t)\|^2.
function rewriteInnerMathTokens(inner: string): string {
  let out = inner.replace(/\bgrad\b/g, "\\nabla ");
  const greekRe = new RegExp(
    `(?<![\\\\a-zA-Z])(${GREEK_NAMES})(?![a-zA-Z])`,
    "g"
  );
  out = out.replace(greekRe, (_, name) => `\\${name}`);
  return out;
}

// Wrap bare LaTeX-ish patterns so KaTeX can render them. Handles:
//   b_{P,j}, D^{(η-1)/2}, M_t      (existing)
//   ||grad f(x_t)||^2 → \|\nabla f(x_t)\|^2
//   sigma, eta^2, \Omega_n          (greek names)
//   n^2                              (bare letter ^ digit)
// Each pass re-saves $...$ pairs so later passes never reach into prior
// wraps. Only applied to model-authored finding text.
function wrapBareMath(text: string): string {
  const saved: string[] = [];
  let s = saveMathPairs(text, saved);

  // Norms first: consume `||...||^N` as a whole so inner subscripts/greek
  // letters end up inside one $...$ block rather than fragmenting.
  s = s.replace(
    /\|\|([^|\n]{1,120}?)\|\|(\^\{[^}]+\}|\^[0-9a-zA-Z]+|_\{[^}]+\}|_[0-9a-zA-Z]+)?/g,
    (_, inner, mod) => `$\\|${rewriteInnerMathTokens(inner)}\\|${mod ?? ""}$`
  );
  s = saveMathPairs(s, saved);

  s = s.replace(/([\w\u0300-\u036F\u0370-\u03FF]+_\{[^}]+\})/g, (m) => `$${m}$`);
  s = saveMathPairs(s, saved);

  s = s.replace(/([\w\u0370-\u03FF]+\^\{[^}]+\})/g, (m) => `$${m}$`);
  s = saveMathPairs(s, saved);

  s = s.replace(
    /(?<![a-zA-Z_])([A-Za-z\u0370-\u03FF]_[a-zA-Z0-9])(?![a-zA-Z_\{])/g,
    (m) => `$${m}$`
  );
  s = saveMathPairs(s, saved);

  // Greek letter names. Negative lookbehind blocks `\sigma` (already a
  // command) and mid-word matches ("asymptote" must not become "a$\sigma$…").
  const greekRe = new RegExp(
    `(?<![\\\\a-zA-Z])(${GREEK_NAMES})(?![a-zA-Z])(\\^\\{[^}]+\\}|\\^[0-9a-zA-Z]+|_\\{[^}]+\\}|_[0-9a-zA-Z]+)?`,
    "g"
  );
  s = s.replace(greekRe, (_, name, mod) => `$\\${name}${mod ?? ""}$`);
  s = saveMathPairs(s, saved);

  // Bare `x^N` where N is digits. Guard against `_{`, `${`, and letters on
  // either side so we don't split mid-identifier or inside placeholders.
  s = s.replace(
    /(?<![\\$a-zA-Z_{\x02])([a-zA-Z])\^([0-9]+)(?![a-zA-Z0-9])/g,
    (_, v, sup) => `$${v}^${sup}$`
  );

  s = s.replace(/\x02(\d+)\x02/g, (_, idx) => saved[parseInt(idx)]);
  return s;
}

// Escape $<digit> as currency ($100) but preserve real LaTeX ($1.25 \pm 0.11$).
function escapeCurrency(text: string): string {
  const saved: string[] = [];
  let s = text.replace(/\$(\d[^$]*?)\$/g, (match, inner) => {
    if (/\\[a-zA-Z]|[_^{}]/.test(inner) || !/\s/.test(inner)) {
      const idx = saved.length;
      saved.push(match);
      return `\x01${idx}\x01`;
    }
    return match;
  });
  s = s.replace(/\$(\d)/g, "\\$$$1");
  s = s.replace(/\x01(\d+)\x01/g, (_, idx) => saved[parseInt(idx)]);
  return s;
}

const styleOverrides = `
.math-markdown i { margin: 0 0.06em; }
.math-markdown .katex { font-size: 1em; }
.math-markdown .katex-display {
  margin: 0.75rem 0;
  display: flex;
  justify-content: center;
  width: 100%;
}
.math-markdown.inline .katex-display {
  display: inline;
  margin: 0;
}
/* Broken LaTeX (missing braces, unterminated $...$) should read as plain source,
 * not as angry red text. Inherit the surrounding text color + strip the border. */
.math-markdown .katex-error {
  color: inherit !important;
  background: transparent !important;
  border: none !important;
  font-family: inherit !important;
}
`;

export interface MathMarkdownProps {
  children: string;
  className?: string;
  /** Render as <span> instead of <div>. Use inside block quotes or list items. */
  inline?: boolean;
  /** Wrap bare math-looking patterns in $...$ before rendering. Default true. */
  autoWrapMath?: boolean;
}

export const MathMarkdown = React.memo(function MathMarkdown({
  children,
  className,
  inline = false,
  autoWrapMath = true,
}: MathMarkdownProps) {
  const Wrapper = inline ? "span" : "div";
  const source = React.useMemo(() => {
    const pre = autoWrapMath ? wrapBareMath(children ?? "") : (children ?? "");
    return escapeCurrency(pre);
  }, [children, autoWrapMath]);

  return (
    <Wrapper className={cn("math-markdown", inline && "inline", className)}>
      <style dangerouslySetInnerHTML={{ __html: styleOverrides }} />
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[
          [rehypeKatex, { strict: false, errorColor: "inherit", throwOnError: false }],
          rehypeMathUnicodeItalic,
        ]}
        components={{
          p: ({ children: c }) =>
            inline ? <span>{c}</span> : <p className="leading-relaxed">{c}</p>,
          code: ({ children: c, ...rest }: any) => (
            <code
              {...rest}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground"
            >
              {c}
            </code>
          ),
          pre: ({ children: c }: any) => (
            <pre className="my-2 overflow-x-auto rounded-md border border-border bg-muted p-3 font-mono text-xs text-foreground">
              {c}
            </pre>
          ),
          ul: ({ children: c }) => (
            <ul className="my-1 ml-4 list-disc space-y-0.5 marker:text-muted-foreground">
              {c}
            </ul>
          ),
          ol: ({ children: c }) => (
            <ol className="my-1 ml-4 list-decimal space-y-0.5">{c}</ol>
          ),
          li: ({ children: c }) => <li>{c}</li>,
          strong: ({ children: c }) => (
            <strong className="font-semibold text-foreground">{c}</strong>
          ),
          em: ({ children: c }) => <em className="italic">{c}</em>,
          a: ({ href, children: c }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {c}
            </a>
          ),
          blockquote: ({ children: c }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 italic text-foreground/80">
              {c}
            </blockquote>
          ),
        }}
      >
        {source}
      </ReactMarkdown>
    </Wrapper>
  );
});

// Back-compat shims so older imports keep working. Both now go through the
// safe markdown+KaTeX pipeline instead of raw katex.renderToString.
export function Formula({
  tex,
  block = false,
  className,
}: {
  tex: string;
  block?: boolean;
  className?: string;
}) {
  const wrapped = block ? `$$${tex}$$` : `$${tex}$`;
  return (
    <MathMarkdown inline className={className} autoWrapMath={false}>
      {wrapped}
    </MathMarkdown>
  );
}

export function MathText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <MathMarkdown inline className={className}>
      {text}
    </MathMarkdown>
  );
}
