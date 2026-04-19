"use client";

import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Copy, Download, Sparkles, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { InfoTrigger } from "@/components/glossary/info-trigger";
import { api } from "@/lib/api";
import type { Paper } from "@/lib/types";

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

export function DraftReviewDialog({
  paper,
  open,
  onOpenChange,
}: {
  paper: Paper;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [markdown, setMarkdown] = React.useState("");
  const [isGenerating, setGenerating] = React.useState(false);
  const [draftId, setDraftId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const generate = React.useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      // Real backend call — persists a ReviewDraft on the paper so it can
      // be reloaded, PATCHed, and exported later.
      const draft = await api.generateReview(paper.id);
      setMarkdown(draft.markdown);
      setDraftId(draft.draft_id);
    } catch (e) {
      // Fall back to client-side composition so the user still sees something
      // if the backend call fails. Surfaces the error on the dialog.
      const msg = e instanceof Error ? e.message : "Failed to generate review";
      setError(msg);
      setMarkdown(composeDraftReview(paper));
      toast.error("Review generation failed", { description: msg });
    } finally {
      setGenerating(false);
    }
  }, [paper]);

  React.useEffect(() => {
    if (open && !markdown) generate();
  }, [open, markdown, generate]);

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
    } else {
      toast.info("PDF export", {
        description: "Will call the backend /export?format=pdf endpoint once wired.",
      });
    }
  };

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
              Auto-composed from your {paper.findings.length} findings. Edit the
              markdown on the left; the preview updates live. Copy or download
              when ready.
            </DialogDescription>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={generate}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
              Regenerate
            </Button>
            <Button size="sm" variant="outline" onClick={() => download("md")}>
              <Download className="size-3.5" /> .md
            </Button>
            <Button size="sm" variant="outline" onClick={() => download("pdf")}>
              <Download className="size-3.5" /> .pdf
            </Button>
            <Button size="sm" onClick={copy}>
              <Copy className="size-3.5" /> Copy
            </Button>
          </div>
        </DialogHeader>

        <div className="grid max-h-[70vh] grid-cols-2 gap-4 overflow-hidden">
          <div className="flex min-h-0 flex-col">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Sparkles className="size-3" /> Markdown
            </div>
            <Textarea
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
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
            <div className="flex-1 overflow-y-auto rounded-md border border-border bg-card p-5">
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
      </DialogContent>
    </Dialog>
  );
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
  // Keep $...$ segments intact so the preview renders them; strip only raw \text braces etc.
  return s.replace(/\\text\{/g, "").replace(/\}/g, (m, i) => (s[i - 1] === "{" ? "}" : m));
}
