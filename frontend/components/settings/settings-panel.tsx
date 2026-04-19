"use client";

import * as React from "react";
import Link from "next/link";
import { ExternalLink, Info } from "lucide-react";
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
import { useSettings } from "@/lib/hooks/use-settings";
import { initialsFor, useProfile } from "@/lib/hooks/use-profile";

const MODEL_OPTIONS = [
  { value: "", label: "Backend default (claude-sonnet-4-6)" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (default — fast, cheap)" },
  { value: "claude-opus-4-7", label: "Claude Opus 4.7 (slower, higher quality)" },
  { value: "gpt-4.1", label: "GPT-4.1 (OpenAI)" },
  { value: "deepseek-v3", label: "DeepSeek V3" },
];

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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model</CardTitle>
          <CardDescription>
            Which LLM Loupe uses for extract and verify. Vision localization
            always uses a vision-capable model configured in the backend.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">Default model</Label>
            <select
              value={settings.defaultModel}
              onChange={(e) => settings.setDefaultModel(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Provider API keys are configured in the backend{" "}
            <code className="rounded bg-muted px-1 font-mono">.env</code>. A
            future release will surface key status here.
          </p>
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
