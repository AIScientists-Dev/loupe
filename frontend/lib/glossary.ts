/**
 * Loupe glossary — single source of truth for in-app definitions.
 * Consumed by the glossary sheet and linked contextually via <InfoTrigger>.
 */

import type { IssueType, Severity } from "./types";

export type GlossaryTerm = {
  id: string;
  label: string;
  /** Color chip class (Tailwind); used for severity. */
  chip?: string;
  /** Issue-type id, so we can render the matching icon. */
  issueType?: IssueType;
  /** Severity key, so we can render a severity swatch. */
  severity?: Severity;
  short: string;
  example?: string;
};

export type GlossarySection = {
  id: string;
  title: string;
  intro: string;
  terms: GlossaryTerm[];
};

export const GLOSSARY: GlossarySection[] = [
  {
    id: "severity",
    title: "Severity levels",
    intro:
      "Every finding carries one of three severity levels. Severity is Loupe's best guess at how much the issue matters for publication — you always make the final call.",
    terms: [
      {
        id: "high",
        label: "High",
        severity: "high",
        short:
          "A substantive error that would block publication. Flipped inequality, wrong constant, or an unstated assumption that is load-bearing for the result.",
        example:
          "A Hoeffding-style bound stated as 2exp(−nε) instead of 2exp(−2nε²).",
      },
      {
        id: "medium",
        label: "Medium",
        severity: "medium",
        short:
          "Worth a careful look — likely correctable without changing the main claim. Missing proof step, ambiguous quantifier, or an assumption that should be stated.",
        example:
          'A proof that uses "by Assumption A3" when A3 is never actually stated.',
      },
      {
        id: "low",
        label: "Low",
        severity: "low",
        short:
          "Minor issue with exposition or citation. Does not affect correctness; the author should still address for clarity.",
        example:
          'Citing "a well-known result" for the KKT conditions without naming Bickel or Tibshirani.',
      },
    ],
  },
  {
    id: "issue-types",
    title: "Types of issue",
    intro:
      "Nine categories Loupe flags in statistics and theory papers. The glyph on each finding card tells you the category at a glance.",
    terms: [
      {
        id: "arithmetic",
        label: "Arithmetic error",
        issueType: "arithmetic",
        short:
          "A numerical or algebraic step that doesn't check out: miscounted terms, wrong summation, a factor of 2 dropped somewhere.",
        example: "∑ᵢi = n²/2 instead of n(n+1)/2.",
      },
      {
        id: "logic",
        label: "Logic error",
        issueType: "logic",
        short:
          "An inference that doesn't follow: flipped inequality direction, invalid case split, or a conclusion that doesn't match the premises.",
        example: "Concluding Tₙ ≤ C√n from premises that give Tₙ ≥ C√n.",
      },
      {
        id: "unstated_assumption",
        label: "Unstated assumption",
        issueType: "unstated_assumption",
        short:
          'The proof invokes a condition ("by Assumption A3…") that was never actually stated in the paper. Sometimes the author assumed a standard result implicitly.',
        example: 'A proof citing "Assumption A3" when only A1 and A2 appear.',
      },
      {
        id: "wrong_constant",
        label: "Wrong constant",
        issueType: "wrong_constant",
        short:
          "The shape of the bound is correct but the numerical constant or exponent is off. Classic Hoeffding / concentration-bound territory.",
        example: "2exp(−nε) instead of 2exp(−2nε²).",
      },
      {
        id: "quantifier_scope",
        label: "Quantifier scope",
        issueType: "quantifier_scope",
        short:
          "∀ and ∃ swapped, or the order of quantifiers produces a different (usually stronger) claim than the proof establishes.",
        example:
          "Claiming ∃δ ∀ε when the proof only establishes ∀ε ∃δ(ε).",
      },
      {
        id: "citation_required",
        label: "Citation required",
        issueType: "citation_required",
        short:
          'The step leans on a "well-known" result without naming it. Usually Loupe can suggest the standard reference.',
        example:
          '"By a well-known result, the KKT conditions imply…" without a citation.',
      },
      {
        id: "definition_mismatch",
        label: "Definition mismatch",
        issueType: "definition_mismatch",
        short:
          "A term is used in two slightly different ways across the paper, or the definition on page 2 doesn't match the usage on page 5.",
        example:
          '"Consistency" defined in probability but later used almost-sure.',
      },
      {
        id: "missing_step",
        label: "Missing step",
        issueType: "missing_step",
        short:
          'A gap between two lines of a proof. The jump may be valid but it isn\'t shown; an expert can fill it, a student can\'t.',
        example:
          "Going from a union bound to a final tail bound without the intermediate inequality.",
      },
      {
        id: "other",
        label: "Other issue",
        issueType: "other",
        short:
          "A flagged step that doesn't fit the above categories. Treat as a manual-review prompt.",
      },
    ],
  },
  {
    id: "pipeline",
    title: "Pipeline",
    intro:
      "Loupe's analysis runs in three steps. You see them ticking by in the live progress view when a paper is analyzing.",
    terms: [
      {
        id: "parse",
        label: "Parse",
        short:
          "Extracts a clean markdown representation from the PDF, plus a page map so every paragraph knows which page it came from. Uses MinerU under the hood.",
      },
      {
        id: "extract_proofs",
        label: "Extract proofs",
        short:
          "Scans the markdown for theorems, lemmas, propositions, and proof blocks. Each block becomes a candidate for verification in the next step.",
      },
      {
        id: "verify_proofs",
        label: "Verify proofs",
        short:
          "For each proof block, Loupe checks arithmetic, logical validity, assumption usage, quantifier scope, constant sharpness, and whether a citation is needed. Findings come from this step.",
      },
    ],
  },
  {
    id: "localization",
    title: "Visual localization",
    intro:
      "After verification produces a finding, Loupe pins it to a region on the PDF via a vision pass. Three possible outcomes:",
    terms: [
      {
        id: "pending",
        label: "Pending (shimmer)",
        short:
          "The vision step is running on this finding. Its bounding box shows a dashed, pulsing outline until it settles.",
      },
      {
        id: "done",
        label: "Pinned",
        short:
          "Vision confirmed the evidence appears at the coarse location the parser reported. The box becomes solid.",
      },
      {
        id: "dropped",
        label: "Dropped",
        short:
          "Vision couldn't find the quoted evidence on the page — usually because the parser munged a math symbol. The finding is silently removed rather than shown at the wrong spot.",
      },
    ],
  },
  {
    id: "decisions",
    title: "Decisions",
    intro:
      'Every finding starts "Open." Your verdict as editor — Agree or Dismiss — determines whether it shows up in the generated review.',
    terms: [
      {
        id: "open",
        label: "Open",
        short:
          "You haven't decided yet. Open findings are the default view in the panel.",
      },
      {
        id: "agree",
        label: "Agreed",
        short:
          "You agree this is a real issue. Agreed findings appear as Major concerns in the generated review.",
      },
      {
        id: "dismiss",
        label: "Dismissed",
        short:
          "You don't consider this a real issue (false positive, or already addressed elsewhere). Dismissed findings are omitted from the review body but stay visible via the Show dismissed toggle.",
      },
      {
        id: "change",
        label: "Change",
        short:
          "Every decision is reversible. Click Change on a decided card to re-open it and pick again.",
      },
    ],
  },
  {
    id: "investigate",
    title: "Investigate",
    intro:
      'When a finding warrants more than a quick yes/no, open its Investigate thread. Loupe answers in the context of the paper. Use the quick-action chips to steer the conversation:',
    terms: [
      {
        id: "rederive",
        label: "Re-derive this step",
        short:
          'Asks Loupe to walk through the flagged derivation explicitly. Useful when you suspect the author glossed over a step.',
      },
      {
        id: "counterexample",
        label: "Find a counterexample",
        short:
          "Asks Loupe to construct a concrete case that violates the stated bound. Strong signal when one exists.",
      },
      {
        id: "citation",
        label: "Check the citation",
        short:
          'Asks Loupe to look up the cited result (optionally via web search) and verify whether it actually supports the step as claimed.',
      },
      {
        id: "fix",
        label: "Propose a fix",
        short:
          "Asks Loupe to suggest how the author might correct the issue — a tighter constant, an added assumption, a reshaped argument.",
      },
    ],
  },
  {
    id: "review",
    title: "Draft review",
    intro:
      'When every finding has a decision, the Generate review button composes a structured review from your verdicts. The modal shows markdown on the left and a live preview on the right.',
    terms: [
      {
        id: "generate",
        label: "Generate",
        short:
          "Composes a fresh review from scratch based on current decisions. Fast; use it when you change a decision and want the review to reflect it.",
      },
      {
        id: "edit",
        label: "Edit inline",
        short:
          "The markdown is yours to rewrite. Every keystroke re-renders the preview. Loupe's output is a scaffold, not a finished product — your voice goes here.",
      },
      {
        id: "export",
        label: "Copy / Download",
        short:
          "Copy to clipboard, download as `.md` for pasting into a venue form, or download as `.pdf` for archiving.",
      },
    ],
  },
  {
    id: "shortcuts",
    title: "Keyboard shortcuts",
    intro:
      "Loupe is keyboard-first for editors who triage a lot of findings. Shortcuts are off when a text field is focused.",
    terms: [
      { id: "nav", label: "j / k", short: "Next / previous finding" },
      { id: "decide", label: "a / d", short: "Agree / Dismiss the selected finding" },
      { id: "investigate", label: "i", short: "Open the Investigate thread" },
      {
        id: "review",
        label: "r",
        short: "Generate review (when every finding is decided)",
      },
      { id: "help", label: "?", short: "Open the shortcuts cheatsheet" },
      { id: "glossary", label: "h", short: "Open this glossary" },
    ],
  },
];

export function findSection(id: string | null): GlossarySection | null {
  if (!id) return null;
  return GLOSSARY.find((s) => s.id === id) ?? null;
}
