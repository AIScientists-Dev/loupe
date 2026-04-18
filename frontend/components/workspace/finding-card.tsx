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
import { MathText } from "./math";
import { ISSUE_META, SEVERITY_META } from "./issue-type";
import { IssueIcon } from "./issue-icon";
import type { Finding } from "@/lib/types";

export type FindingCardProps = {
  finding: Finding;
  active: boolean;
  onSelect: () => void;
  onDecide: (verdict: "agree" | "dismiss", note?: string) => Promise<void>;
  onInvestigate: (message: string) => Promise<void>;
  /** Keyed imperative signal: when `v` changes, open the given mode. */
  commandSignal?: { mode: "agree" | "dismiss" | "investigate"; v: number };
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
                "rounded-full border px-2 py-0.5 font-medium uppercase tracking-wide",
                sev.chip
              )}
            >
              {sev.label}
            </span>
            <span className="text-muted-foreground">{meta.short}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              p.{finding.bbox_page ?? "?"}
            </span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">
              {Math.round(finding.confidence * 100)}% confidence
            </span>
            <LocalizeBadge status={finding.localize_status} />
          </div>

          <p className="mt-2 text-sm leading-relaxed text-foreground">
            <MathText text={finding.description} />
          </p>

          <blockquote className="mt-2.5 rounded-md border border-border/80 bg-muted/40 px-3 py-2 font-serif text-[13px] leading-relaxed text-foreground/85">
            <MathText text={finding.evidence_quote} />
          </blockquote>

          {decided ? (
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
                        ? "Optional: a one-line note the author will see."
                        : "Optional: why you're dismissing this finding."
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

function LocalizeBadge({ status }: { status: Finding["localize_status"] }) {
  if (status === "done") return null;
  if (status === "dropped") {
    return (
      <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
        dropped (parser mismatch)
      </span>
    );
  }
  return (
    <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-highlight/20 px-2 py-0.5 text-[10px] text-foreground">
      <Loader2 className="size-2.5 animate-spin" /> pinning…
    </span>
  );
}

function DecidedFooter({
  finding,
  onReopen,
  busy,
}: {
  finding: Finding;
  onReopen: () => void;
  busy: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs"
    >
      <div className="flex items-center gap-2">
        {finding.decision === "agree" ? (
          <span className="inline-flex items-center gap-1.5 font-medium text-primary">
            <ShieldCheck className="size-3.5" /> Agreed
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
            <ShieldOff className="size-3.5" /> Dismissed
          </span>
        )}
        {finding.decision_note && (
          <span className="truncate text-muted-foreground">
            — {finding.decision_note}
          </span>
        )}
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={(e) => {
          e.stopPropagation();
          onReopen();
        }}
        disabled={busy}
      >
        <Undo2 className="size-3.5" /> Change
      </Button>
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
    if (!msg.trim()) return;
    await onSend(msg.trim());
    setText("");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 space-y-2"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c}
            onClick={() => fire(c)}
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
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Done
          </Button>
          <Button size="sm" onClick={() => fire(text)} disabled={busy || !text.trim()}>
            {busy && <Loader2 className="size-3 animate-spin" />} Send
          </Button>
        </div>
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
      {exchanges.map((x) => (
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
          <div className="text-[13px] leading-relaxed text-foreground/90">
            <MathText text={x.text} />
          </div>
        </div>
      ))}
    </motion.div>
  );
}
