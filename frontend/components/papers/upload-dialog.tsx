"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import { useQuery } from "@tanstack/react-query";
import { FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useUploadPaper } from "@/lib/hooks/use-papers";
import { useOnboarding } from "@/lib/hooks/use-onboarding";
import { api } from "@/lib/api";
import type {
  ReviewStyle,
  ReviewStyleSnapshot,
  VenueType,
} from "@/lib/types";

const VENUE_TYPE_OPTIONS: { value: VenueType; label: string }[] = [
  { value: "journal", label: "Journal" },
  { value: "conference", label: "Conference" },
  { value: "grant", label: "Grant (NSF / NIH)" },
  { value: "thesis", label: "Thesis" },
  { value: "other", label: "Other" },
];

const STYLE_OPTIONS: { value: ReviewStyle; label: string }[] = [
  { value: "rigorous_skeptical", label: "Rigorous-skeptical" },
  { value: "constructive_mentoring", label: "Constructive" },
  { value: "terse_expert", label: "Terse-expert" },
];

// Defaults for venue/folder/style. Persisted across sessions in localStorage
// — onboarding (Phase 2) will seed these; for now they fall back to sane
// values for a stats-paper editor.
const STORAGE_KEY = "loupe.uploadDefaults";

type UploadDefaults = {
  venue_type: VenueType;
  venue_name: string;
  folder: string;
  review_style: ReviewStyle;
};

// "Inbox" is retired in v3. New uploads default to "no folder" (Unfiled) so
// a user without venue folders configured doesn't end up in a phantom bucket.
// When onboarding has been completed, the first declared venue takes over.
const DEFAULTS: UploadDefaults = {
  venue_type: "journal",
  venue_name: "",
  folder: "",
  review_style: "rigorous_skeptical",
};

function loadDefaults(): UploadDefaults {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<UploadDefaults>) };
  } catch {
    return DEFAULTS;
  }
}

function saveDefaults(d: UploadDefaults) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    // ignore quota errors
  }
}

export function UploadDialog({
  trigger,
  defaultFolder,
}: {
  trigger?: React.ReactNode;
  /** Pre-select a folder (e.g. when opening the dialog from inside a folder). */
  defaultFolder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const router = useRouter();
  const upload = useUploadPaper();

  const onboardingProfile = useOnboarding((s) => s.profile);

  const [config, setConfig] = React.useState<UploadDefaults>(() => loadDefaults());
  React.useEffect(() => {
    if (!open) return;
    const stored = loadDefaults();
    // Apply precedence: explicit prop > stored defaults > onboarding's first
    // declared venue > "" (Unfiled). Style + venue_type fall back the same way.
    const seedFolder =
      defaultFolder
      || (stored.folder && stored.folder !== "Inbox" ? stored.folder : "")
      || onboardingProfile?.default_venues?.[0]
      || "";
    const seedStyle = stored.review_style
      ?? onboardingProfile?.default_review_style?.style
      ?? "rigorous_skeptical";
    setConfig({ ...stored, folder: seedFolder, review_style: seedStyle });
  }, [open, defaultFolder, onboardingProfile]);

  const foldersQuery = useQuery({
    queryKey: ["folders"],
    queryFn: api.listFolders,
    staleTime: 30_000,
  });
  // v3: drop the legacy "Inbox" default. /folders now returns Folder records;
  // surface their names. If the backend list is empty *and* onboarding hasn't
  // seeded venues yet, fall back to the broad-strokes set.
  const folderOptions = React.useMemo(() => {
    const set = new Set<string>();
    for (const f of foldersQuery.data ?? []) {
      if (f.name && f.name !== "Inbox") set.add(f.name);
    }
    for (const v of onboardingProfile?.default_venues ?? []) set.add(v);
    if (set.size === 0) {
      ["Journal", "Conference", "Grant", "Thesis"].forEach((f) => set.add(f));
    }
    return Array.from(set);
  }, [foldersQuery.data, onboardingProfile]);

  const upload$ = upload.mutateAsync;

  // Per-file upload status, surfaced as a small queue list while a batch is
  // in flight. Reset when the dialog opens so old entries don't leak.
  type Item = { name: string; status: "queued" | "uploading" | "done" | "failed"; error?: string };
  const [queue, setQueue] = React.useState<Item[]>([]);
  React.useEffect(() => {
    if (open) setQueue([]);
  }, [open]);

  const onDrop = React.useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const review_style: ReviewStyleSnapshot = { style: config.review_style };
      // Seed the visible queue so the user sees every dropped file even
      // before the upload kicks off.
      setQueue(files.map((f) => ({ name: f.name, status: "queued" as const })));
      saveDefaults(config);

      let firstUploadedId: string | null = null;
      let ok = 0;
      let failed = 0;

      // Sequential upload — keeps backend kind for parallel triage tasks +
      // makes per-file progress feedback simpler. Switch to /papers/batch
      // once that lands.
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        setQueue((prev) =>
          prev.map((q, idx) => (idx === i ? { ...q, status: "uploading" } : q)),
        );
        try {
          const paper = await upload$({
            file,
            venue_type: config.venue_type,
            venue_name: config.venue_name.trim() || undefined,
            folder: config.folder,
            review_style,
          });
          if (firstUploadedId === null) firstUploadedId = paper.id;
          ok += 1;
          setQueue((prev) =>
            prev.map((q, idx) => (idx === i ? { ...q, status: "done" } : q)),
          );
        } catch (err) {
          failed += 1;
          setQueue((prev) =>
            prev.map((q, idx) =>
              idx === i
                ? {
                    ...q,
                    status: "failed",
                    error: err instanceof Error ? err.message : "Failed",
                  }
                : q,
            ),
          );
        }
      }

      if (ok > 0 && failed === 0 && files.length === 1 && firstUploadedId) {
        // Single-file happy path — keep the original behaviour: drop the
        // user straight into the new paper.
        toast.success("Upload received", {
          description: `Triaging ${files[0].name} · ~1 min.`,
        });
        setOpen(false);
        router.push(`/papers/${firstUploadedId}`);
        return;
      }

      // Batch path — let the queue display tell the story. Toast the summary.
      if (ok > 0) {
        toast.success(`Uploaded ${ok} paper${ok === 1 ? "" : "s"}`, {
          description:
            failed > 0
              ? `${failed} failed — see the queue list.`
              : "Triage runs on each — open one to watch the verdict come in.",
        });
      }
      if (ok === 0 && failed > 0) {
        toast.error("All uploads failed", {
          description: `${failed} file${failed === 1 ? "" : "s"} did not upload.`,
        });
      }
    },
    [config, router, upload$],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/pdf": [".pdf"] },
    // v3: multi-file upload — drop a folder of PDFs and let triage run on
    // each. The backend already kicks an independent triage task per upload.
    multiple: true,
    maxSize: 20 * 1024 * 1024,
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Upload className="size-3.5" /> Upload paper
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload papers</DialogTitle>
          <DialogDescription>
            Drop one or many PDFs. Loupe runs a ~1 min triage on each, then waits
            for your call before any deep work.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <ConfigGrid config={config} folderOptions={folderOptions} onChange={setConfig} />

          <div
            {...getRootProps()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-colors",
              isDragActive
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40 hover:bg-accent/30",
              upload.isPending && "pointer-events-none opacity-60",
            )}
          >
            <input {...getInputProps()} />
            <div className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
              {upload.isPending ? (
                <Loader2 className="size-5 animate-spin" />
              ) : (
                <FileUp className="size-5" />
              )}
            </div>
            <p className="text-sm font-medium">
              {upload.isPending
                ? "Uploading…"
                : isDragActive
                  ? "Drop your PDFs here"
                  : "Drop PDFs here or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground">
              PDF only · up to 20 MB each · multiple files allowed
            </p>
          </div>

          {queue.length > 0 && (
            <ul className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border bg-muted/30 p-2">
              {queue.map((q, i) => (
                <li
                  key={`${q.name}-${i}`}
                  className="flex items-center gap-2 text-[12px]"
                >
                  <span className="grid size-4 shrink-0 place-items-center">
                    {q.status === "uploading" && (
                      <Loader2 className="size-3 animate-spin text-primary" />
                    )}
                    {q.status === "queued" && (
                      <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                    )}
                    {q.status === "done" && (
                      <span className="size-1.5 rounded-full bg-primary" />
                    )}
                    {q.status === "failed" && (
                      <span className="size-1.5 rounded-full bg-destructive" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
                    {q.name}
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[10px]",
                      q.status === "failed"
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {q.status === "failed" && q.error ? q.error : q.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ConfigGrid({
  config,
  folderOptions,
  onChange,
}: {
  config: UploadDefaults;
  folderOptions: string[];
  onChange: (c: UploadDefaults) => void;
}) {
  const set = <K extends keyof UploadDefaults>(
    k: K,
    v: UploadDefaults[K],
  ) => onChange({ ...config, [k]: v });

  return (
    <div className="grid grid-cols-2 gap-3 text-xs">
      <Field label="Venue type">
        <select
          value={config.venue_type}
          onChange={(e) => set("venue_type", e.target.value as VenueType)}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {VENUE_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Venue name">
        <Input
          value={config.venue_name}
          onChange={(e) => set("venue_name", e.target.value)}
          placeholder="e.g. JASA, NeurIPS, NSF DMS"
          className="h-9 text-sm"
        />
      </Field>
      <Field label="Folder">
        <select
          value={config.folder}
          onChange={(e) => set("folder", e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="">Unfiled</option>
          {folderOptions.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Review style">
        <select
          value={config.review_style}
          onChange={(e) => set("review_style", e.target.value as ReviewStyle)}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {STYLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
