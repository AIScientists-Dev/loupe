import type { IssueType, Severity } from "@/lib/types";

export const ISSUE_META: Record<IssueType, { label: string; short: string }> = {
  arithmetic: { label: "Arithmetic error", short: "Arithmetic" },
  logic: { label: "Logic error", short: "Logic" },
  unstated_assumption: { label: "Unstated assumption", short: "Assumption" },
  wrong_constant: { label: "Wrong constant", short: "Constant" },
  quantifier_scope: { label: "Quantifier scope", short: "Quantifier" },
  citation_required: { label: "Citation required", short: "Citation" },
  definition_mismatch: { label: "Definition mismatch", short: "Definition" },
  missing_step: { label: "Missing step", short: "Missing step" },
  other: { label: "Other issue", short: "Other" },
};

export const SEVERITY_META: Record<
  Severity,
  { label: string; stripe: string; chip: string; text: string }
> = {
  high: {
    label: "High",
    stripe: "bg-severity-high",
    chip: "bg-severity-high/12 text-severity-high border-severity-high/30",
    text: "text-severity-high",
  },
  medium: {
    label: "Medium",
    stripe: "bg-severity-medium",
    chip: "bg-severity-medium/15 text-severity-medium border-severity-medium/30",
    text: "text-severity-medium",
  },
  low: {
    label: "Low",
    stripe: "bg-severity-low",
    chip: "bg-severity-low/12 text-severity-low border-severity-low/30",
    text: "text-severity-low",
  },
};

export const SEVERITY_DESCRIPTIONS: Record<Severity, string> = {
  high: "A substantive error that would block publication. Flipped inequality, wrong constant, or an unstated assumption that is load-bearing for the result.",
  medium: "Worth a careful look — likely correctable without changing the main claim. Missing proof step, ambiguous quantifier, or an assumption that should be stated.",
  low: "Minor issue with exposition or citation. Does not affect correctness; author should still address for clarity.",
};
