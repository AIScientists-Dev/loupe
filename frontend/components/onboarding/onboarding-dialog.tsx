"use client";

import * as React from "react";
import { ArrowRight, Plus, Sparkles, X } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useSubmitOnboarding } from "@/lib/hooks/use-onboarding";
import type { ReviewStyle } from "@/lib/types";

const SUGGESTED_VENUES_BY_FIELD: Record<string, string[]> = {
  Statistics: ["JASA", "Biometrika", "Annals of Statistics"],
  "ML theory": ["NeurIPS", "ICML", "COLT"],
  "CS theory": ["STOC", "FOCS", "SODA"],
  Probability: ["Annals of Probability", "Bernoulli"],
  Other: [],
};

// v3: replaces the prior name + role combo with a privacy-respecting Title
// dropdown. Drives nothing functional today — used by review-generation
// prompts later to calibrate tone (Faculty vs PhD reviewer write differently).
const TITLE_OPTIONS = [
  "Faculty",
  "Postdoc",
  "PhD candidate",
  "Industry researcher",
  "Journal editor",
  "Other",
];

const STYLE_OPTIONS: { value: ReviewStyle; label: string; help: string }[] = [
  { value: "rigorous_skeptical", label: "Rigorous-skeptical", help: "Pushes back; demands rigor" },
  { value: "constructive_mentoring", label: "Constructive", help: "Collegial; suggests fixes" },
  { value: "terse_expert", label: "Terse-expert", help: "No filler; bullets" },
];

/**
 * First-visit onboarding gate. Locks the library until the user fills out
 * a quick profile that drives:
 *   - default venues (each becomes a venue folder)
 *   - default review style (used at upload + finalize-review)
 *
 * Persists to localStorage today; once /v1/onboarding lands the complete()
 * action also POSTs to the backend (see V3_BACKEND_SPEC.md §2).
 */
export function OnboardingDialog() {
  const submit = useSubmitOnboarding();
  const [submitting, setSubmitting] = React.useState(false);

  // v3: no name field. Backend's profile.name is filled with "Anonymous" at
  // submit time so the schema stays stable. Editor identity stays private.
  const [title, setTitle] = React.useState(TITLE_OPTIONS[0]);
  const [field, setField] = React.useState("Statistics");
  const [interests, setInterests] = React.useState<string[]>([]);
  const [newInterest, setNewInterest] = React.useState("");
  const [venues, setVenues] = React.useState<string[]>(SUGGESTED_VENUES_BY_FIELD["Statistics"] ?? []);
  const [newVenue, setNewVenue] = React.useState("");
  const [style, setStyle] = React.useState<ReviewStyle>("rigorous_skeptical");

  // Re-suggest venues whenever the field changes — only if the user hasn't
  // started customizing.
  React.useEffect(() => {
    setVenues(SUGGESTED_VENUES_BY_FIELD[field] ?? []);
  }, [field]);

  const addVenue = () => {
    const v = newVenue.trim();
    if (!v) return;
    setVenues((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setNewVenue("");
  };
  const removeVenue = (v: string) =>
    setVenues((prev) => prev.filter((x) => x !== v));

  const addInterest = () => {
    const v = newInterest.trim();
    if (!v) return;
    setInterests((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setNewInterest("");
  };
  const removeInterest = (v: string) =>
    setInterests((prev) => prev.filter((x) => x !== v));

  const onSubmit = async () => {
    if (venues.length === 0) {
      toast.error("Add at least one venue so Loupe can group your papers.");
      return;
    }
    setSubmitting(true);
    try {
      await submit({
        // Privacy: no name collected. Backend stores "Anonymous" so the
        // existing schema stays untouched — we'll surface this as nothing
        // in the UI and the review prompts won't reference a personal name.
        name: "Anonymous",
        role: title,
        field,
        research_interests: interests,
        default_venues: venues,
        default_review_style: { style, tone: "formal", length: "standard" },
      });
      toast.success("Welcome to Loupe", {
        description: `${venues.length} venue folder${venues.length === 1 ? "" : "s"} ready.`,
      });
    } catch (err) {
      toast.error("Couldn't save your profile", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent className="max-h-[92vh] w-[min(640px,95vw)] overflow-y-auto sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="text-xl">Welcome to Loupe</DialogTitle>
          <DialogDescription>
            Three quick questions — Loupe uses these to calibrate review tone
            and file papers into the right folders. No name needed; everything
            is changeable later in settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Title">
              <select
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {TITLE_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Field">
              <select
                value={field}
                onChange={(e) => setField(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              >
                {Object.keys(SUGGESTED_VENUES_BY_FIELD).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field
            label="Research interests"
            hint="Helps Loupe pick up on what you'd push back on hardest. Optional."
          >
            <div className="flex flex-wrap gap-1.5">
              {interests.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => removeInterest(v)}
                  className="group inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                  title="Remove"
                >
                  {v}
                  <X className="size-3 opacity-50 group-hover:opacity-100" />
                </button>
              ))}
              {interests.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  e.g. high-dimensional statistics, Bayesian inference, optimal transport
                </span>
              )}
            </div>
            <div className="mt-2 flex gap-1.5">
              <Input
                value={newInterest}
                onChange={(e) => setNewInterest(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addInterest();
                  }
                }}
                placeholder="Add an interest"
                className="h-8 text-sm"
              />
              <Button size="sm" variant="outline" onClick={addInterest}>
                <Plus className="size-3.5" /> Add
              </Button>
            </div>
          </Field>

          <Field label="Venues you review for" hint="One folder per venue. You can rename or delete later.">
            <div className="flex flex-wrap gap-1.5">
              {venues.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => removeVenue(v)}
                  className="group inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary"
                  title="Remove"
                >
                  {v}
                  <X className="size-3 opacity-50 group-hover:opacity-100" />
                </button>
              ))}
              {venues.length === 0 && (
                <span className="text-xs text-muted-foreground">No venues yet — add one below.</span>
              )}
            </div>
            <div className="mt-2 flex gap-1.5">
              <Input
                value={newVenue}
                onChange={(e) => setNewVenue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addVenue();
                  }
                }}
                placeholder="Add a venue (e.g. JASA, NeurIPS)"
                className="h-8 text-sm"
              />
              <Button size="sm" variant="outline" onClick={addVenue}>
                <Plus className="size-3.5" /> Add
              </Button>
            </div>
          </Field>

          <Field label="Default review voice" hint="Used as the starting style for every review you generate.">
            <div className="grid grid-cols-3 gap-1.5">
              {STYLE_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setStyle(s.value)}
                  className={cn(
                    "rounded-md border px-3 py-2 text-left text-xs transition-colors",
                    style === s.value
                      ? "border-primary bg-primary/5 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  <div className="font-medium text-foreground">{s.label}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{s.help}</div>
                </button>
              ))}
            </div>
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <div className="text-[11px] text-muted-foreground">
            <Sparkles className="mr-1 inline-block size-3" />
            We won't ask again — settings live under your avatar.
          </div>
          <Button onClick={onSubmit} disabled={submitting} className="gap-1.5">
            Get started <ArrowRight className="size-3.5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <div className="text-xs font-medium text-foreground">{label}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      <div>{children}</div>
    </label>
  );
}
