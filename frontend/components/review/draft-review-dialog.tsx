"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  ArrowLeftRight,
  Copy,
  Download,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { InfoTrigger } from "@/components/glossary/info-trigger";
import { api } from "@/lib/api";
import type {
  Paper,
  ReviewConfig,
  ReviewLength,
  ReviewSection,
  ReviewStyle,
  ReviewTone,
} from "@/lib/types";

const MARKDOWN_COMPONENTS = {
  h1: (props: React.HTMLProps<HTMLHeadingElement>) => (
    <h1 {...props} className="mt-0 mb-3 text-xl font-semibold tracking-tight" />
  ),
  h2: (props: React.HTMLProps<HTMLHeadingElement>) => (
    <h2 {...props} className="mt-5 mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground" />
  ),
  p: (props: React.HTMLProps<HTMLParagraphElement>) => (
    <p {...props} className="mb-3 text-sm leading-relaxed" />
  ),
  ul: (props: React.HTMLProps<HTMLUListElement>) => (
    <ul {...props} className="mb-3 ml-5 list-disc space-y-1 text-sm leading-relaxed" />
  ),
  li: (props: React.HTMLProps<HTMLLIElement>) => (
    <li {...props} className="text-sm leading-relaxed" />
  ),
  blockquote: (props: React.HTMLProps<HTMLQuoteElement>) => (
    <blockquote {...props} className="mb-3 border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground" />
  ),
  code: (props: React.HTMLProps<HTMLElement>) => (
    <code {...props} className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]" />
  ),
};

// ---- config presets --------------------------------------------------------

const FIELD_OPTIONS = [
  "Statistics",
  "ML theory",
  "CS theory",
  "Probability",
  "Other",
] as const;

const STYLE_OPTIONS: { value: ReviewStyle; label: string; help: string }[] = [
  { value: "rigorous_skeptical", label: "Rigorous-skeptical", help: "Pushes back; demands rigor" },
  { value: "constructive_mentoring", label: "Constructive", help: "Collegial; suggests fixes" },
  { value: "terse_expert", label: "Terse-expert", help: "No filler; bullets" },
];

const TONE_OPTIONS: { value: ReviewTone; label: string }[] = [
  { value: "formal", label: "Formal" },
  { value: "neutral", label: "Neutral" },
  { value: "casual", label: "Casual" },
];

const LENGTH_OPTIONS: { value: ReviewLength; label: string; hint: string }[] = [
  { value: "short", label: "Short", hint: "~300w" },
  { value: "standard", label: "Standard", hint: "~600w" },
  { value: "thorough", label: "Thorough", hint: "~1200w" },
];

const SECTION_OPTIONS: { value: ReviewSection; label: string }[] = [
  { value: "summary", label: "Summary" },
  { value: "strengths", label: "Strengths" },
  { value: "weaknesses", label: "Weaknesses" },
  { value: "detailed", label: "Detailed comments" },
  { value: "questions", label: "Questions" },
  { value: "minor", label: "Minor points" },
];

const DEFAULT_CONFIG: Required<ReviewConfig> = {
  field: "Statistics",
  style: "rigorous_skeptical",
  tone: "formal",
  length: "standard",
  sections: SECTION_OPTIONS.map((s) => s.value),
};

const STORAGE_KEY = "loupe.reviewConfig";

function loadConfig(): Required<ReviewConfig> {
  if (typeof window === "undefined") return DEFAULT_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<ReviewConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(cfg: Required<ReviewConfig>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore quota / private-browsing errors
  }
}

// ---- dialog ----------------------------------------------------------------

type Phase = "configure" | "generating" | "ready";

export function DraftReviewDialog({
  paper,
  open,
  onOpenChange,
  initialDraftId,
}: {
  paper: Paper;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, load this draft on open (from review history) instead of showing the config form. */
  initialDraftId?: string;
}) {
  const [phase, setPhase] = React.useState<Phase>("configure");
  const [config, setConfig] = React.useState<Required<ReviewConfig>>(DEFAULT_CONFIG);
  const [markdown, setMarkdown] = React.useState("");
  const [draftId, setDraftId] = React.useState<string | null>(null);
  const [scrollSync, setScrollSync] = React.useState(true);

  // Re-hydrate config from localStorage whenever the dialog opens.
  React.useEffect(() => {
    if (open) {
      setConfig(loadConfig());
      // If the user already generated a draft earlier in this session, keep it.
      if (!markdown) setPhase("configure");
    }
  }, [open, markdown]);

  // Load a specific historical draft when the caller passed an initialDraftId.
  React.useEffect(() => {
    if (!open || !initialDraftId) return;
    if (draftId === initialDraftId) return;
    let cancelled = false;
    setPhase("generating");
    setMarkdown("");
    api
      .getReview(paper.id, initialDraftId)
      .then((d) => {
        if (cancelled) return;
        setMarkdown(d.markdown);
        setDraftId(d.draft_id);
        setPhase("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Failed to load draft";
        toast.error("Could not load draft", { description: msg });
        setPhase("configure");
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialDraftId, paper.id, draftId]);

  const generate = React.useCallback(
    async (cfg: Required<ReviewConfig>) => {
      setPhase("generating");
      setMarkdown("");
      try {
        const body: ReviewConfig = {
          field: cfg.field.trim() || undefined,
          style: cfg.style,
          tone: cfg.tone,
          length: cfg.length,
          sections: cfg.sections,
        };
        const draft = await api.generateReview(paper.id, body);
        setMarkdown(draft.markdown);
        setDraftId(draft.draft_id);
        setPhase("ready");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to generate review";
        toast.error("Review generation failed", { description: msg });
        setMarkdown(composeDraftReview(paper));
        setPhase("ready");
      }
    },
    [paper]
  );

  const handleGenerate = () => {
    saveConfig(config);
    void generate(config);
  };

  /**
   * v2: Generate Final Review — calls /finalize-review which freezes the
   * paper's aggregate score on the backend, then loads the new draft. The
   * frozen score + radar snapshot are embedded as a markdown header so the
   * editor's exported review carries the dimensional context.
   */
  const finalize = React.useCallback(async () => {
    setPhase("generating");
    setMarkdown("");
    try {
      const cfg: ReviewConfig = {
        field: config.field.trim() || undefined,
        style: config.style,
        tone: config.tone,
        length: config.length,
        sections: config.sections,
      };
      const { aggregate, draft_id } = await api.finalizeReview(paper.id, cfg);
      // After finalize, fetch the actual draft markdown the backend produced.
      const draft = await api.getReview(paper.id, draft_id);
      const radarBlock = renderRadarBlock(paper, aggregate);
      setMarkdown(radarBlock + draft.markdown);
      setDraftId(draft_id);
      setPhase("ready");
      toast.success("Final review ready", {
        description: `Score frozen at ${aggregate.toFixed(1)} / 10.`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Finalize failed";
      toast.error("Could not finalize review", { description: msg });
      setPhase("configure");
    }
  }, [config, paper]);

  const copy = async () => {
    await navigator.clipboard.writeText(markdown);
    toast.success("Copied", { description: "Review copied to clipboard." });
  };

  const download = (fmt: "md" | "pdf") => {
    if (fmt === "md") {
      const blob = new Blob([markdown], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${paper.title.slice(0, 60).replace(/\s+/g, "_")}_review.md`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Downloaded", { description: "Markdown review saved." });
    } else if (!draftId) {
      toast.info("PDF export", {
        description: "Available after the backend finishes persisting the draft.",
      });
    } else {
      window.open(api.exportReview(paper.id, draftId, "pdf"), "_blank");
    }
  };

  const isGenerating = phase === "generating";
  const hasDraft = phase === "ready";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(1100px,95vw)] sm:max-w-none">
        <DialogHeader className="flex-row items-start justify-between gap-4">
          <div>
            <DialogTitle className="inline-flex items-center gap-1.5 text-lg">
              Draft review
              <InfoTrigger
                section="review"
                label="About draft reviews"
                size={13}
              />
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs">
              {phase === "configure" &&
                `Set the reviewer persona, then compose a draft from your ${paper.findings.length} findings.`}
              {phase === "generating" && "Composing your review…"}
              {phase === "ready" &&
                `Auto-composed from your ${paper.findings.length} findings. Edit on the left; preview updates live.`}
            </DialogDescription>
          </div>
          {hasDraft && (
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPhase("configure")}
              >
                <Settings2 className="size-3.5" /> Settings
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void generate(config)}
                disabled={isGenerating}
              >
                <RefreshCw className="size-3.5" /> Regenerate
              </Button>
              <Button size="sm" variant="outline" onClick={() => download("md")}>
                <Download className="size-3.5" /> .md
              </Button>
              <Button size="sm" variant="outline" onClick={() => download("pdf")}>
                <Download className="size-3.5" /> .pdf
              </Button>
              <Button size="sm" variant="ghost" onClick={copy}>
                <Copy className="size-3.5" /> Copy
              </Button>
              {paper.dimension_scores && paper.dimension_scores.length > 0 && (
                <Button
                  size="sm"
                  onClick={() => void finalize()}
                  disabled={isGenerating || paper.final_score !== undefined}
                  title={
                    paper.final_score !== undefined
                      ? "Score already frozen"
                      : "Freeze the score and produce the final review"
                  }
                >
                  <Sparkles className="size-3.5" />
                  {paper.final_score !== undefined
                    ? `Finalized (${paper.final_score.toFixed(1)})`
                    : "Generate final review"}
                </Button>
              )}
            </div>
          )}
        </DialogHeader>

        {phase === "configure" && (
          <ConfigForm
            config={config}
            onChange={setConfig}
            onGenerate={handleGenerate}
            onReset={() => setConfig(DEFAULT_CONFIG)}
            findingsCount={paper.findings.length}
          />
        )}

        {phase !== "configure" && (
          <SplitEditor
            markdown={markdown}
            onChange={setMarkdown}
            isGenerating={isGenerating}
            scrollSync={scrollSync}
            onToggleScrollSync={() => setScrollSync((v) => !v)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---- config form ----------------------------------------------------------

function ConfigForm({
  config,
  onChange,
  onGenerate,
  onReset,
  findingsCount,
}: {
  config: Required<ReviewConfig>;
  onChange: (c: Required<ReviewConfig>) => void;
  onGenerate: () => void;
  onReset: () => void;
  findingsCount: number;
}) {
  const set = <K extends keyof Required<ReviewConfig>>(
    key: K,
    value: Required<ReviewConfig>[K],
  ) => onChange({ ...config, [key]: value });

  const toggleSection = (s: ReviewSection) => {
    const has = config.sections.includes(s);
    const next = has
      ? config.sections.filter((x) => x !== s)
      : [...config.sections, s];
    set("sections", next);
  };

  const isCustomField = !FIELD_OPTIONS.includes(config.field as (typeof FIELD_OPTIONS)[number]);

  return (
    <div className="max-h-[70vh] overflow-y-auto pr-1">
      <div className="space-y-6 py-1">
        <Row label="Field" hint="Used to calibrate domain terminology.">
          <div className="flex flex-wrap gap-1.5">
            {FIELD_OPTIONS.map((f) => (
              <Pill
                key={f}
                active={f === "Other" ? isCustomField : config.field === f}
                onClick={() => set("field", f === "Other" ? "" : f)}
              >
                {f}
              </Pill>
            ))}
            {isCustomField && (
              <Input
                value={config.field}
                onChange={(e) => set("field", e.target.value)}
                placeholder="e.g. Econometrics"
                className="h-8 w-48 text-xs"
                autoFocus
              />
            )}
          </div>
        </Row>

        <Row label="Style" hint="The reviewer persona.">
          <div className="grid grid-cols-3 gap-1.5">
            {STYLE_OPTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => set("style", s.value)}
                className={cn(
                  "rounded-md border px-3 py-2 text-left text-xs transition-colors",
                  config.style === s.value
                    ? "border-primary bg-primary/5 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/40"
                )}
              >
                <div className="font-medium text-foreground">{s.label}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{s.help}</div>
              </button>
            ))}
          </div>
        </Row>

        <Row label="Tone">
          <Segmented
            options={TONE_OPTIONS}
            value={config.tone}
            onChange={(v) => set("tone", v)}
          />
        </Row>

        <Row label="Length">
          <Segmented
            options={LENGTH_OPTIONS.map((o) => ({
              value: o.value,
              label: (
                <span className="inline-flex items-baseline gap-1">
                  {o.label}
                  <span className="text-[10px] text-muted-foreground">{o.hint}</span>
                </span>
              ),
            }))}
            value={config.length}
            onChange={(v) => set("length", v)}
          />
        </Row>

        <Row label="Sections" hint="Which parts the review should include.">
          <div className="flex flex-wrap gap-1.5">
            {SECTION_OPTIONS.map((s) => (
              <Pill
                key={s.value}
                active={config.sections.includes(s.value)}
                onClick={() => toggleSection(s.value)}
              >
                {s.label}
              </Pill>
            ))}
          </div>
        </Row>
      </div>

      <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Reset to defaults
        </button>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-muted-foreground">
            {findingsCount} findings will be summarized
          </span>
          <Button size="sm" onClick={onGenerate} disabled={config.sections.length === 0}>
            <Sparkles className="size-3.5" /> Generate review
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] items-start gap-4">
      <div className="pt-1">
        <div className="text-xs font-medium text-foreground">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-xs transition-colors",
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:bg-muted/40"
      )}
    >
      {children}
    </button>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-[5px] px-3 py-1 text-xs transition-colors",
            value === o.value
              ? "bg-primary/10 text-foreground"
              : "text-muted-foreground hover:bg-muted/40"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SplitEditor({
  markdown,
  onChange,
  isGenerating,
  scrollSync,
  onToggleScrollSync,
}: {
  markdown: string;
  onChange: (v: string) => void;
  isGenerating: boolean;
  scrollSync: boolean;
  onToggleScrollSync: () => void;
}) {
  const mdRef = React.useRef<HTMLTextAreaElement | null>(null);
  const pvRef = React.useRef<HTMLDivElement | null>(null);
  // Tracks which pane initiated the current scroll so the sibling's scroll
  // handler doesn't bounce back and create a feedback loop.
  const drivingRef = React.useRef<"md" | "pv" | null>(null);

  const handleMdScroll = React.useCallback(() => {
    if (!scrollSync) return;
    if (drivingRef.current === "pv") return;
    const md = mdRef.current;
    const pv = pvRef.current;
    if (!md || !pv) return;
    const mdMax = md.scrollHeight - md.clientHeight;
    const pvMax = pv.scrollHeight - pv.clientHeight;
    if (mdMax <= 0 || pvMax <= 0) return;
    drivingRef.current = "md";
    pv.scrollTop = (md.scrollTop / mdMax) * pvMax;
    requestAnimationFrame(() => {
      drivingRef.current = null;
    });
  }, [scrollSync]);

  const handlePvScroll = React.useCallback(() => {
    if (!scrollSync) return;
    if (drivingRef.current === "md") return;
    const md = mdRef.current;
    const pv = pvRef.current;
    if (!md || !pv) return;
    const mdMax = md.scrollHeight - md.clientHeight;
    const pvMax = pv.scrollHeight - pv.clientHeight;
    if (mdMax <= 0 || pvMax <= 0) return;
    drivingRef.current = "pv";
    md.scrollTop = (pv.scrollTop / pvMax) * mdMax;
    requestAnimationFrame(() => {
      drivingRef.current = null;
    });
  }, [scrollSync]);

  return (
    <div className="grid max-h-[70vh] grid-cols-2 gap-4 overflow-hidden">
      <div className="flex min-h-0 flex-col">
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <Sparkles className="size-3" /> Markdown
          </div>
          <button
            type="button"
            onClick={onToggleScrollSync}
            className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition-colors",
              scrollSync
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/40"
            )}
            title={scrollSync ? "Scroll sync on" : "Scroll sync off"}
            aria-pressed={scrollSync}
          >
            <ArrowLeftRight className="size-3" />
            {scrollSync ? "Synced" : "Independent"}
          </button>
        </div>
        <Textarea
          ref={mdRef}
          value={markdown}
          onChange={(e) => onChange(e.target.value)}
          onScroll={handleMdScroll}
          className={cn(
            "h-full flex-1 resize-none font-mono text-[12.5px] leading-relaxed",
            isGenerating && "opacity-60"
          )}
          placeholder={isGenerating ? "Generating…" : ""}
        />
      </div>
      <div className="flex min-h-0 flex-col">
        <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Preview
        </div>
        <div
          ref={pvRef}
          onScroll={handlePvScroll}
          className="flex-1 overflow-y-auto rounded-md border border-border bg-card p-5"
        >
          {isGenerating && !markdown ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Composing your review…
            </div>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={MARKDOWN_COMPONENTS}
            >
              {markdown}
            </ReactMarkdown>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * v2: render an ASCII-style summary block for the dimensional scores +
 * frozen aggregate. Embeds at the top of the final-review markdown so the
 * exported .md / .pdf carries the radar context. Cheap (no chart lib);
 * looks decent in a monospace block.
 */
function renderRadarBlock(paper: Paper, aggregate: number): string {
  const dims = paper.dimension_scores ?? [];
  if (dims.length === 0) return "";
  const rows = dims
    .map((d) => {
      const bar = "▮".repeat(Math.round(d.score)) +
        "▯".repeat(Math.max(0, 10 - Math.round(d.score)));
      const label = d.dimension.charAt(0).toUpperCase() + d.dimension.slice(1);
      return `${label.padEnd(11)} ${bar}  ${d.score.toFixed(1)}`;
    })
    .join("\n");
  return [
    `> **Aggregate score · ${aggregate.toFixed(1)} / 10** _(frozen)_`,
    "",
    "```",
    rows,
    "```",
    "",
  ].join("\n");
}

function composeDraftReview(paper: Paper): string {
  const agreed = paper.findings.filter((f) => f.decision === "agree");
  const dismissed = paper.findings.filter((f) => f.decision === "dismiss");
  const openF = paper.findings.filter((f) => !f.decision);

  const lines: string[] = [];
  lines.push(`# Review: ${paper.title}`);
  lines.push("");
  lines.push("## Summary");
  lines.push(
    `This paper was reviewed by Loupe's automated proof checker and audited by the editor. Across ${paper.findings.length} flagged step${paper.findings.length === 1 ? "" : "s"}, the editor agreed with **${agreed.length}** and dismissed **${dismissed.length}**. The substantive concerns below should be addressed before the paper can be recommended for publication.`
  );
  lines.push("");

  if (agreed.length) {
    lines.push("## Major concerns (for author action)");
    agreed.forEach((f, i) => {
      lines.push(
        `**${i + 1}. ${labelForIssue(f.issue_type)} — page ${f.bbox_page ?? "?"}.** ${stripMath(f.description)}`
      );
      lines.push("");
      lines.push(`> ${stripMath(f.evidence_quote)}`);
      lines.push("");
      if (f.decision_note) {
        lines.push(`*Editor note: ${f.decision_note}*`);
        lines.push("");
      }
    });
  }

  if (openF.length) {
    lines.push("## Open items");
    openF.forEach((f) => {
      lines.push(
        `- *p.${f.bbox_page ?? "?"}:* ${labelForIssue(f.issue_type)} — ${stripMath(f.description)}`
      );
    });
    lines.push("");
  }

  if (dismissed.length) {
    lines.push("## Not pursued");
    dismissed.forEach((f) => {
      lines.push(
        `- *p.${f.bbox_page ?? "?"}:* ${labelForIssue(f.issue_type)} — ${f.decision_note ?? "dismissed on review."}`
      );
    });
    lines.push("");
  }

  lines.push("## Recommendation");
  lines.push(
    agreed.length > 0
      ? "Major revision. The concerns above are substantive enough that a corrected proof and a revised statement of assumptions are required before the paper can be considered for acceptance."
      : "Minor revision. No substantive errors surfaced; the author should address the dismissed points only where they improve exposition."
  );
  lines.push("");
  lines.push("---");
  lines.push(
    `*Prepared with [Loupe](https://github.com/morphmind/loupe) — an open-source AI proof reviewer from MorphMind.*`
  );

  return lines.join("\n");
}

function labelForIssue(type: string): string {
  return type
    .split("_")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

function stripMath(s: string): string {
  return s.replace(/\\text\{/g, "").replace(/\}/g, (m, i) => (s[i - 1] === "{" ? "}" : m));
}
