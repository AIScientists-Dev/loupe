"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  X,
  MessageSquare,
  Undo2,
  Loader2,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MathMarkdown } from "./math";
import { ISSUE_META, SEVERITY_META } from "./issue-type";
import { IssueIcon } from "./issue-icon";
import { InfoTrigger } from "@/components/glossary/info-trigger";
import type { Finding } from "@/lib/types";

export type FindingCardProps = {
  finding: Finding;
  active: boolean;
  onSelect: () => void;
  onDecide: (verdict: "agree" | "dismiss", note?: string) => Promise<void>;
  onInvestigate: (message: string) => Promise<void>;
  /** Invoked when the user asks to place this finding's bbox by hand. */
  onRequestPlacement?: () => void;
  /** Keyed imperative signal: when `v` changes, open the given mode. */
  commandSignal?: { mode: "agree" | "dismiss" | "investigate"; v: number };
  /** When true, hide all action affordances — used on /share/:id. */
  readOnly?: boolean;
  /** Data attribute so the panel can scroll the selected card to top. */
  "data-finding-id"?: string;
};

export function FindingCard(props: FindingCardProps) {
  const { finding, active, onSelect } = props;
  const meta = ISSUE_META[finding.issue_type] ?? ISSUE_META.other;
  const sev = SEVERITY_META[finding.severity];

  const [mode, setMode] = React.useState<"idle" | "agree" | "dismiss" | "investigate">("idle");
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // Local "I'm revising my decision" flag so Change doesn't need a backend un-decide.
  const [editing, setEditing] = React.useState(false);
  const decided = !!finding.decision && !editing;

  // When the backend decision changes (e.g. fresh fetch), exit editing mode.
  React.useEffect(() => {
    setEditing(false);
  }, [finding.decision]);

  // External command signal (keyboard shortcuts) opens the right action mode.
  React.useEffect(() => {
    if (!props.commandSignal) return;
    if (finding.decision && !editing) setEditing(true);
    setMode(props.commandSignal.mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.commandSignal?.v]);

  const handleDecide = async (verdict: "agree" | "dismiss") => {
    setBusy(true);
    try {
      await props.onDecide(verdict, note.trim() || undefined);
      setMode("idle");
      setNote("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onSelect}
      data-finding-id={props["data-finding-id"]}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-xl border bg-card transition-colors",
        active
          ? "border-primary/50 shadow-sm ring-1 ring-primary/30"
          : "border-border hover:border-primary/30"
      )}
    >
      <div className={cn("absolute left-0 top-0 h-full w-1", sev.stripe)} />

      <div className="flex items-start gap-3 p-4 pl-5">
        <div
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-md border",
            sev.chip
          )}
        >
          <IssueIcon type={finding.issue_type} size={18} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium uppercase tracking-wide",
                sev.chip
              )}
            >
              {sev.label}
              <InfoTrigger
                section="severity"
                term={finding.severity}
                label={`About ${sev.label} severity`}
                size={11}
                className="opacity-70 hover:opacity-100"
              />
            </span>
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              {meta.short}
              <InfoTrigger
                section="issue-types"
                term={finding.issue_type}
                label={`About ${meta.label}`}
                size={11}
              />
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              p.{finding.bbox?.page ?? finding.bbox_page ?? "?"}
            </span>
            {finding.dimension && finding.dimension !== "proof" && (
              <DimensionChip dimension={finding.dimension} />
            )}
            <LocalizeBadge
              status={finding.localize_status}
              onPlace={props.onRequestPlacement}
              readOnly={props.readOnly}
            />
          </div>

          <div className="mt-2 text-sm leading-relaxed text-foreground">
            <MathMarkdown inline>{finding.description}</MathMarkdown>
          </div>

          <div className="mt-2.5 overflow-x-auto rounded-md border border-border/80 bg-muted/40 px-3 py-2 font-serif text-[13px] leading-relaxed text-foreground/85">
            <MathMarkdown inline>{wrapIfLatex(finding.evidence_quote)}</MathMarkdown>
          </div>

          {props.readOnly ? (
            finding.decision ? (
              <DecidedFooter finding={finding} onReopen={() => {}} busy={false} readOnly />
            ) : null
          ) : decided ? (
            <DecidedFooter
              finding={finding}
              onReopen={() => setEditing(true)}
              busy={busy}
            />
          ) : (
            <AnimatePresence mode="wait">
              {mode === "idle" ? (
                <motion.div
                  key="idle"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mt-3 flex flex-wrap items-center gap-2"
                >
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMode("agree");
                    }}
                  >
                    <Check className="size-3.5" /> Agree
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMode("dismiss");
                    }}
                  >
                    <X className="size-3.5" /> Dismiss
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMode("investigate");
                    }}
                  >
                    <MessageSquare className="size-3.5" /> Investigate
                  </Button>
                </motion.div>
              ) : mode === "investigate" ? (
                <InvestigatePanel
                  finding={finding}
                  onCancel={() => setMode("idle")}
                  onSend={async (msg) => {
                    setBusy(true);
                    try {
                      await props.onInvestigate(msg);
                    } finally {
                      setBusy(false);
                    }
                  }}
                  busy={busy}
                />
              ) : (
                <motion.div
                  key={mode}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="mt-3 space-y-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={
                      mode === "agree"
                        ? "Optional — add a note to include in the generated review."
                        : "Optional — why you're dismissing this finding (used to refine future analysis)."
                    }
                    className="min-h-[64px] text-sm"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setMode("idle");
                        setNote("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleDecide(mode)}
                      disabled={busy}
                    >
                      {busy && <Loader2 className="size-3 animate-spin" />}
                      {mode === "agree" ? (
                        <>
                          <ShieldCheck className="size-3.5" /> Confirm agree
                        </>
                      ) : (
                        <>
                          <ShieldOff className="size-3.5" /> Confirm dismiss
                        </>
                      )}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}

          {finding.exchanges.length > 0 && (
            <ExchangeThread exchanges={finding.exchanges} />
          )}
        </div>
      </div>
    </motion.article>
  );
}

/**
 * When the LLM emits a raw LaTeX expression with no `$...$` wrapper, KaTeX
 * never renders it. Heuristic: if the string contains LaTeX command-like
 * tokens (`\mathbb`, `\frac`, `\sum`, `\leq`, etc.) and doesn't already
 * contain a `$`, wrap the whole thing as inline math.
 *
 * Safe for natural-language quotes: we only wrap when there's at least one
 * backslash-command AND the input has no `$` we'd clobber.
 */
const _LATEX_SIGNAL_RE =
  /\\(mathbb|mathbf|mathcal|mathrm|mathit|frac|sum|prod|int|sqrt|leq|geq|lesssim|gtrsim|exp|log|ln|sin|cos|tan|left|right|begin|end|alpha|beta|gamma|lambda|sigma|tau|epsilon|delta|varepsilon|varphi|rightarrow|leftarrow|cdot|bigcap|bigcup|operatorname|text|mid|langle|rangle|triangleq)/;

/**
 * v2: small inline chip rendered next to the issue type when the finding
 * belongs to a non-proof dimension (literature/clarity/numerical/etc.).
 * Suppressed for `dimension="proof"` since that's the default and adding a
 * chip there would just be visual noise.
 */
function DimensionChip({ dimension }: { dimension: NonNullable<Finding["dimension"]> }) {
  const tone =
    dimension === "literature"
      ? "border-primary/30 text-primary"
      : dimension === "clarity"
        ? "border-muted-foreground/30 text-muted-foreground"
        : dimension === "numerical"
          ? "border-severity-medium/30 text-severity-medium"
          : dimension === "relevance"
            ? "border-brand/30 text-brand"
            : dimension === "novelty"
              ? "border-highlight/40 text-highlight-foreground"
              : "border-muted-foreground/30 text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
        tone,
      )}
    >
      {dimension}
    </span>
  );
}

function wrapIfLatex(s: string): string {
  if (!s) return s;
  if (s.includes("$")) return s;
  if (!_LATEX_SIGNAL_RE.test(s)) return s;
  return `$${s}$`;
}

function LocalizeBadge({
  status,
  onPlace,
  readOnly,
}: {
  status: Finding["localize_status"];
  onPlace?: () => void;
  readOnly?: boolean;
}) {
  if (status === "done") return null;
  if (status === "user_placed") {
    if (readOnly || !onPlace) return null;
    return (
      <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-[10px] text-foreground">
        manually placed
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPlace();
          }}
          className="ml-1 underline underline-offset-2 hover:no-underline"
        >
          Redraw
        </button>
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-highlight/20 px-2 py-0.5 text-[10px] text-foreground">
        <Loader2 className="size-2.5 animate-spin" /> pinning…
      </span>
    );
  }
  if (status === "approximate") {
    return (
      <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-900">
        approximate location
        {!readOnly && onPlace && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlace();
            }}
            className="ml-1 underline underline-offset-2 hover:no-underline"
          >
            Place manually
          </button>
        )}
      </span>
    );
  }
  if (status === "not_located") {
    return (
      <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-900">
        couldn't locate exact spot
        {!readOnly && onPlace && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onPlace();
            }}
            className="ml-1 underline underline-offset-2 hover:no-underline"
          >
            Place manually
          </button>
        )}
      </span>
    );
  }
  if (status === "quote_unverified") {
    return (
      <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-900">
        quote unverified
      </span>
    );
  }
  if (status === "dropped") {
    // Legacy — old papers only.
    return (
      <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
        dropped (parser mismatch)
      </span>
    );
  }
  return null;
}

function DecidedFooter({
  finding,
  onReopen,
  busy,
  readOnly,
}: {
  finding: Finding;
  onReopen: () => void;
  busy: boolean;
  readOnly?: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {finding.decision === "agree" ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-primary">
            <ShieldCheck className="size-3.5" /> Agreed
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-muted-foreground">
            <ShieldOff className="size-3.5" /> Dismissed
          </span>
        )}
        {finding.decision_note && (
          <span
            className="min-w-0 flex-1 truncate text-muted-foreground"
            title={finding.decision_note}
          >
            — {finding.decision_note}
          </span>
        )}
      </div>
      {!readOnly && (
        <Button
          size="sm"
          variant="ghost"
          className="shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onReopen();
          }}
          disabled={busy}
        >
          <Undo2 className="size-3.5" /> Reopen
        </Button>
      )}
    </motion.div>
  );
}

function InvestigatePanel({
  finding,
  onSend,
  onCancel,
  busy,
}: {
  finding: Finding;
  onSend: (msg: string) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}) {
  const [text, setText] = React.useState("");
  const chips = [
    "Re-derive this step",
    "Find a counterexample",
    "Check the citation",
    "Propose a fix",
  ];

  const fire = async (msg: string) => {
    const trimmed = msg.trim();
    if (!trimmed) return;
    // Clear the textarea BEFORE the await so the user gets immediate visual
    // feedback; the optimistic exchange (user msg + "…thinking" placeholder)
    // appears in the thread via the mutation's onMutate hook.
    setText("");
    try {
      await onSend(trimmed);
    } catch {
      // Parent already surfaces a toast on failure; restore text so the user
      // doesn't lose what they typed.
      setText(trimmed);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative mt-3 space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Small close affordance — keeps the primary surface to a single
          Send button while still giving users a way out of investigate mode. */}
      <button
        type="button"
        onClick={onCancel}
        title="Collapse follow-ups"
        aria-label="Collapse follow-ups"
        className="absolute right-0 top-0 inline-flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
      <div className="flex flex-wrap gap-1.5 pr-6">
        {chips.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() =>
              // Populate the textarea instead of auto-firing. User reviews,
              // edits if they want, then clicks Send.
              setText((prev) => (prev.trim() ? `${prev.trim()} — ${c}` : c))
            }
            disabled={busy}
            className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex items-start gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Ask a follow-up about this finding…"
          className="min-h-[64px] text-sm"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              fire(text);
            }
          }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {finding.exchanges.length} message
          {finding.exchanges.length === 1 ? "" : "s"} in thread · ⌘+↵ to send
        </span>
        <Button
          size="sm"
          onClick={() => fire(text)}
          disabled={busy || !text.trim()}
          title={busy ? "Waiting for previous response…" : undefined}
        >
          Send
        </Button>
      </div>
    </motion.div>
  );
}

function ExchangeThread({ exchanges }: { exchanges: Finding["exchanges"] }) {
  return (
    <motion.div
      layout
      className="mt-3 space-y-2 border-t border-border/70 pt-3"
    >
      {exchanges.map((x) => {
        const isPending = x.id.startsWith("_opt_pending_");
        return (
          <div key={x.id} className="flex gap-2">
            <div
              className={cn(
                "mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-medium uppercase tracking-wide",
                x.role === "user"
                  ? "bg-primary/12 text-primary"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {x.role === "user" ? "You" : "Loupe"}
            </div>
            {isPending ? (
              <div className="inline-flex items-center gap-2 text-[13px] italic text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                Louping…
              </div>
            ) : (
              <div className="text-[13px] leading-relaxed text-foreground/90">
                <MathMarkdown inline>{wrapIfLatex(x.text)}</MathMarkdown>
              </div>
            )}
          </div>
        );
      })}
    </motion.div>
  );
}
