"use client";

import * as React from "react";
import Link from "next/link";
import {
  Cloud,
  ExternalLink,
  HardDrive,
  Info,
  Lock,
  ShieldCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { useSettings } from "@/lib/hooks/use-settings";
import { initialsFor, useProfile } from "@/lib/hooks/use-profile";
import { useOnboarding, useSubmitOnboarding } from "@/lib/hooks/use-onboarding";
import { useFolderMutations } from "@/lib/hooks/use-folder-store";
import { Plus, X } from "lucide-react";
import type { ProviderGroup, ReviewStyle } from "@/lib/types";

/**
 * Settings content — rendered inside either the SettingsDialog modal or a
 * future dedicated route. No <header> here; the container provides it.
 */
export function SettingsPanel() {
  const settings = useSettings();
  const profile = useProfile();
  const [name, setName] = React.useState(profile.name);
  const [email, setEmail] = React.useState(profile.email);

  // Keep in sync when profile changes underneath (e.g. Sign out from elsewhere).
  React.useEffect(() => {
    setName(profile.name);
    setEmail(profile.email);
  }, [profile.name, profile.email]);

  const onSaveProfile = () => {
    profile.update({
      name: name.trim() || "Anonymous Reviewer",
      email: email.trim(),
      signedIn: !!(name.trim() || email.trim()),
    });
    toast.success("Profile saved");
  };

  return (
    <div className="flex flex-col gap-5 py-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Account</CardTitle>
          <CardDescription>
            Loupe is local-first — there&apos;s no remote account yet. This is
            how you&apos;ll appear on a shared review if you publish one later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {initialsFor({ name, email, signedIn: profile.signedIn })}
            </span>
            <div className="flex-1 space-y-2">
              <div className="grid gap-1.5">
                <Label htmlFor="name" className="text-xs">Display name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="How you'll sign your reviews"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="email" className="text-xs">Email (optional)</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.edu"
                />
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              Saved locally in your browser. Sign-out clears name + email only.
            </p>
            <div className="flex gap-2">
              {profile.signedIn && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    profile.signOut();
                    setName("Anonymous Reviewer");
                    setEmail("");
                    toast.success("Signed out");
                  }}
                >
                  Sign out
                </Button>
              )}
              <Button size="sm" onClick={onSaveProfile}>
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cost controls</CardTitle>
          <CardDescription>
            Guardrails on how much any single paper can spend. Always
            overridable per upload.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-1.5">
            <Label className="text-xs">
              Default budget cap — ${settings.defaultBudgetCapUsd.toFixed(2)} per paper
            </Label>
            <input
              type="range"
              min={0.25}
              max={10}
              step={0.25}
              value={settings.defaultBudgetCapUsd}
              onChange={(e) => settings.setBudgetCap(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>$0.25</span>
              <span>$2.50 typical</span>
              <span>$10.00</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              When running cost hits this cap, analysis auto-stops and prompts
              you to raise it or accept the partial result.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-3">
            <div>
              <div className="text-xs font-medium">Include figures appendix</div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                By default, Loupe skips figures-only appendix pages (typically
                the biggest cost saver). Enable if your appendix contains
                inline lemmas.
              </p>
            </div>
            <ToggleSwitch
              checked={settings.includeFiguresAppendix}
              onChange={settings.setIncludeFigures}
              label="Include figures appendix"
            />
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3 text-[11px] text-muted-foreground">
            <div className="mb-1 flex items-center gap-1 font-medium text-foreground">
              <Info className="size-3" /> How pricing works
            </div>
            Loupe meters cost from actual token and GPU usage, not estimates.
            Self-hosters set{" "}
            <code className="rounded bg-muted px-1 font-mono">SERVICE_MARKUP=1.0</code>{" "}
            in <code className="rounded bg-muted px-1 font-mono">.env</code> for
            raw pass-through.{" "}
            <Link
              href="https://github.com/morphmind/loupe/blob/main/backend/app/services/pricing.py"
              target="_blank"
              className="inline-flex items-center gap-0.5 text-foreground underline-offset-2 hover:underline"
            >
              View pricing source <ExternalLink className="size-2.5" />
            </Link>
          </div>
        </CardContent>
      </Card>

      <ModelProvidersCard
        defaultModel={settings.defaultModel}
        onPick={settings.setDefaultModel}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review profile</CardTitle>
          <CardDescription>
            Onboarding answers — drives default venue, style, and the venue folder
            list in the sidebar. Changes apply to future uploads only.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReviewProfileEditor />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">About</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <span className="font-medium">Loupe</span> · v0.1.0-dev
          </p>
          <p className="text-muted-foreground">
            An open-source agent by{" "}
            <Link
              href="https://morphmind.ai"
              target="_blank"
              className="text-foreground underline-offset-2 hover:underline"
            >
              MorphMind
            </Link>
            . MIT licensed. Source on{" "}
            <Link
              href="https://github.com/morphmind/loupe"
              target="_blank"
              className="text-foreground underline-offset-2 hover:underline"
            >
              GitHub
            </Link>
            .
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---- Model providers card (grouped picker) -------------------------------

/**
 * Surfaces every provider Loupe knows about — Anthropic, OpenAI, the China
 * group (DeepSeek / Moonshot / MiniMax), Ollama, and a generic OpenAI-compat
 * local endpoint. Pulls from /v1/providers so a group is only marked
 * "configured" when the backend can actually reach it. This is the canonical
 * "Loupe is model-agnostic" surface — the local providers carry the privacy
 * story for unpublished papers.
 */
function ModelProvidersCard({
  defaultModel,
  onPick,
}: {
  defaultModel: string;
  onPick: (m: string) => void;
}) {
  const providersQ = useQuery({
    queryKey: ["providers"],
    queryFn: api.listProviders,
    staleTime: 60_000,
  });
  const groups = providersQ.data ?? [];
  const cloud = groups.filter((g) => g.kind === "cloud");
  const local = groups.filter((g) => g.kind === "local");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Model providers</CardTitle>
        <CardDescription>
          Loupe is model-agnostic. Pick any cloud provider — or run on a local
          model so paper text never leaves your machine.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Privacy-first banner — surfaces the local-LLM path for reviewers
            handling unpublished papers. Quiet container; loud meaning. */}
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-[12px]">
          <ShieldCheck className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="space-y-0.5">
            <div className="font-medium text-foreground">Privacy by design</div>
            <p className="text-muted-foreground">
              Choose an Ollama or OpenAI-compatible local endpoint and Loupe runs
              fully on your hardware — no part of the paper, findings, or chat is
              sent to a third party.
            </p>
          </div>
        </div>

        {providersQ.isLoading && (
          <p className="text-[12px] text-muted-foreground">Checking which providers are configured…</p>
        )}

        {!providersQ.isLoading && cloud.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Cloud providers
            </div>
            <div className="grid gap-2">
              {cloud.map((g) => (
                <ProviderRow
                  key={g.id}
                  group={g}
                  selected={defaultModel}
                  onPick={onPick}
                />
              ))}
            </div>
          </div>
        )}

        {!providersQ.isLoading && local.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Local (private) providers
            </div>
            <div className="grid gap-2">
              {local.map((g) => (
                <ProviderRow
                  key={g.id}
                  group={g}
                  selected={defaultModel}
                  onPick={onPick}
                />
              ))}
            </div>
          </div>
        )}

        <p className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
          Provider keys live in the backend{" "}
          <code className="rounded bg-muted px-1 font-mono">.env</code>. The
          active text model is set via{" "}
          <code className="rounded bg-muted px-1 font-mono">TEXT_MODEL=…</code>{" "}
          and applied across the pipeline; restart the backend after changing
          it. See the{" "}
          <Link
            href="https://github.com/morphmind/loupe#model-providers"
            target="_blank"
            className="underline-offset-2 hover:underline"
          >
            README →
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}

function ProviderRow({
  group,
  selected,
  onPick,
}: {
  group: ProviderGroup;
  selected: string;
  onPick: (m: string) => void;
}) {
  const Icon = group.kind === "local" ? HardDrive : Cloud;
  const dot = group.configured
    ? "bg-emerald-500"
    : "bg-muted-foreground/40";
  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-3 transition-colors",
        group.configured ? "border-border" : "border-dashed border-border/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span>{group.label}</span>
              <span
                className={cn("size-1.5 rounded-full", dot)}
                aria-hidden
                title={group.configured ? "Configured" : "Not configured"}
              />
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {group.configured ? "ready" : "not configured"}
              </span>
            </div>
            <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
              {group.kind === "local" ? (
                <Lock className="mt-0.5 size-2.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : null}
              <span>{group.privacy}</span>
            </p>
          </div>
        </div>
      </div>
      {group.models.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-1 sm:grid-cols-2">
          {group.models.map((m) => {
            const active = selected === m.id;
            const enabled = group.configured;
            return (
              <button
                key={m.id}
                type="button"
                disabled={!enabled}
                onClick={() => onPick(m.id)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  active && enabled
                    ? "border-primary bg-primary/10 text-foreground"
                    : enabled
                      ? "border-border bg-background hover:bg-muted/40"
                      : "cursor-not-allowed border-border/60 bg-muted/20 text-muted-foreground/70",
                )}
              >
                <span className="min-w-0 truncate font-medium">{m.label}</span>
                {m.note && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {m.note}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {group.hint && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 size-3 shrink-0" />
          <span>{group.hint}</span>
        </p>
      )}
    </div>
  );
}

// ---- Review profile editor (revisits onboarding) -------------------------

const STYLE_OPTIONS: { value: ReviewStyle; label: string }[] = [
  { value: "rigorous_skeptical", label: "Rigorous-skeptical" },
  { value: "constructive_mentoring", label: "Constructive" },
  { value: "terse_expert", label: "Terse-expert" },
];

// v3: Title/Degree dropdown — privacy-respecting (no personal name).
const TITLE_OPTIONS = [
  "Faculty",
  "Postdoc",
  "PhD candidate",
  "Industry researcher",
  "Journal editor",
  "Other",
];

function ReviewProfileEditor() {
  const profile = useOnboarding((s) => s.profile);
  const submit = useSubmitOnboarding();
  const reset = useOnboarding((s) => s.reset);
  const { create: createFolder } = useFolderMutations();
  const [saving, setSaving] = React.useState(false);

  // v3: name field gone. profile.name stays "Anonymous" on submit; we
  // don't display or edit it. Research interests added.
  const [title, setTitle] = React.useState(profile?.role ?? TITLE_OPTIONS[0]);
  const [field, setField] = React.useState(profile?.field ?? "Statistics");
  const [interests, setInterests] = React.useState<string[]>(
    profile?.research_interests ?? [],
  );
  const [draftInterest, setDraftInterest] = React.useState("");
  const [venues, setVenues] = React.useState<string[]>(profile?.default_venues ?? []);
  const [draftVenue, setDraftVenue] = React.useState("");
  const [style, setStyle] = React.useState<ReviewStyle>(
    (profile?.default_review_style?.style as ReviewStyle | undefined) ?? "rigorous_skeptical",
  );

  React.useEffect(() => {
    if (!profile) return;
    setTitle(profile.role);
    setField(profile.field);
    setInterests(profile.research_interests ?? []);
    setVenues(profile.default_venues);
    setStyle((profile.default_review_style?.style as ReviewStyle) ?? "rigorous_skeptical");
  }, [profile]);

  const addVenue = () => {
    const v = draftVenue.trim();
    if (!v) return;
    setVenues((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setDraftVenue("");
  };
  const removeVenue = (v: string) =>
    setVenues((prev) => prev.filter((x) => x !== v));

  const addInterest = () => {
    const v = draftInterest.trim();
    if (!v) return;
    setInterests((prev) => (prev.includes(v) ? prev : [...prev, v]));
    setDraftInterest("");
  };
  const removeInterest = (v: string) =>
    setInterests((prev) => prev.filter((x) => x !== v));

  const onSave = async () => {
    if (venues.length === 0) {
      toast.error("Add at least one venue.");
      return;
    }
    setSaving(true);
    const prevVenues = new Set(profile?.default_venues ?? []);
    try {
      await submit({
        name: profile?.name || "Anonymous",
        role: title,
        field,
        research_interests: interests,
        default_venues: venues,
        default_review_style: {
          style,
          tone: profile?.default_review_style?.tone ?? "formal",
          length: profile?.default_review_style?.length ?? "standard",
        },
      });
      // Seed any newly-added venues as folders so they show up in the sidebar.
      // Backend's onboarding endpoint only seeds folders on first call, so
      // subsequent edits need this client-side cascade.
      const added = venues.filter((v) => !prevVenues.has(v));
      for (const v of added) {
        try {
          await createFolder(v);
        } catch {
          // Ignore duplicates — folder already exists.
        }
      }
      toast.success("Profile updated", {
        description:
          added.length > 0
            ? `${added.length} new venue folder${added.length === 1 ? "" : "s"} added.`
            : "Defaults saved.",
      });
    } catch (err) {
      toast.error("Save failed", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Title">
          <select
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
          <Input value={field} onChange={(e) => setField(e.target.value)} />
        </Field>
      </div>

      <Field
        label="Research interests"
        hint="Drives prompt calibration. Add or remove anytime."
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
              Optional · e.g. high-dim statistics, optimal transport
            </span>
          )}
        </div>
        <div className="mt-2 flex gap-1.5">
          <Input
            value={draftInterest}
            onChange={(e) => setDraftInterest(e.target.value)}
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

      <Field label="Venues">
        <div className="flex flex-wrap gap-1.5">
          {venues.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => removeVenue(v)}
              className="group inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary"
              title="Remove from defaults"
            >
              {v}
              <X className="size-3 opacity-50 group-hover:opacity-100" />
            </button>
          ))}
          {venues.length === 0 && (
            <span className="text-xs text-muted-foreground">No venues yet.</span>
          )}
        </div>
        <div className="mt-2 flex gap-1.5">
          <Input
            value={draftVenue}
            onChange={(e) => setDraftVenue(e.target.value)}
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

      <Field label="Default review voice">
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
            </button>
          ))}
        </div>
      </Field>

      <div className="flex items-center justify-between border-t border-border pt-3">
        <button
          type="button"
          onClick={() => {
            if (
              !window.confirm(
                "Reset onboarding? You'll go through the welcome flow on the next library visit.",
              )
            )
              return;
            reset();
            toast.success("Onboarding reset.");
          }}
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
        >
          Reset onboarding
        </button>
        <Button size="sm" onClick={onSave} disabled={saving}>
          Save changes
        </Button>
      </div>
    </div>
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
      <span className="text-xs font-medium text-foreground">{label}</span>
      {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      {children}
    </label>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors",
        checked ? "border-primary bg-primary" : "border-border bg-muted"
      )}
    >
      <span
        className={cn(
          "inline-block size-3.5 rounded-full bg-background shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  );
}
