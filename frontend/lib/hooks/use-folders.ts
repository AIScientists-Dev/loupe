"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Folder, PaperSummary, ReviewStage, VenueType } from "@/lib/types";
import { useFolderStore } from "./use-folder-store";

// ---------------------------------------------------------------------------
// Status folders — pure derived filters over the paper list. No backend.
// Order in the sidebar matches lifecycle order so the eye reads top-to-bottom.
// ---------------------------------------------------------------------------

// v3 simplification: 3 status folders only, mapped 1:1 to backend stage.
// Promising / Rejected become flag chips at the top of the library list,
// not separate folders (avoids the busy "double taxonomy" feeling).
export type StatusFolderKey =
  | "processing"
  | "stage_1"
  | "stage_2";

export const STATUS_FOLDERS: { key: StatusFolderKey; label: string; hint: string }[] = [
  { key: "processing", label: "Processing", hint: "Currently in the pipeline" },
  { key: "stage_1", label: "Stage 1 — Prescreened", hint: "Triage done; choose dive deep or skip" },
  { key: "stage_2", label: "Stage 2 — Deep dived", hint: "Dive done; review or finalize" },
];

function isProcessing(stage?: ReviewStage): boolean {
  return stage === "uploaded" || stage === "triaging" || stage === "diving";
}

/**
 * v3: a paper sits in exactly ONE status bucket, derived from `stage`.
 * Stage 2 absorbs the prior "Reviewed" + "Deep Analyzed" buckets — the
 * frozen-vs-live distinction is now a chip on the report card itself.
 * Flags (promising/rejected) are filter chips, not folders, so we no
 * longer accept the `flag` arg here.
 */
export function statusOf(p: PaperSummary): StatusFolderKey | null {
  if (p.stage === "dived") return "stage_2";
  if (p.stage === "triaged") return "stage_1";
  if (isProcessing(p.stage)) return "processing";
  return null;
}

export interface FolderFilter {
  /** Either a status folder key or a venue folder name. Mutually exclusive. */
  status?: StatusFolderKey;
  venue?: string;
  /** Special value: "all" shows every paper regardless of status/venue. */
  all?: boolean;
}

/** Apply a filter to the paper list. v3: status filters check exactly one
 * bucket; flag filters (promising/rejected) live on a separate axis. */
export function filterPapers(
  papers: PaperSummary[],
  filter: FolderFilter,
): PaperSummary[] {
  if (filter.all) return papers;
  if (filter.venue) {
    return papers.filter((p) => (p.folder ?? null) === filter.venue);
  }
  if (filter.status) {
    return papers.filter((p) => statusOf(p) === filter.status);
  }
  return papers;
}

// ---------------------------------------------------------------------------
// Combined sidebar data: status counts + venue list + active selection.
// ---------------------------------------------------------------------------

export interface SidebarFolderData {
  papers: PaperSummary[];
  statusCounts: Record<StatusFolderKey, number>;
  venueFolders: string[];
  venueCounts: Record<string, number>;
  /** Full Folder records keyed by name — exposes venue_type so the sidebar
   * can render them hierarchically (Journal > JASA, Conference > NeurIPS). */
  folderMeta: Record<string, Folder>;
  /** Number of papers with no venue folder (paper.folder == null/undefined). */
  unfiledCount: number;
  totalCount: number;
}

export function useSidebarFolders(): SidebarFolderData {
  const papersQ = useQuery({
    queryKey: ["papers", "list"],
    queryFn: api.listPapers,
    staleTime: 5_000,
  });
  const foldersQ = useQuery({
    queryKey: ["folders"],
    queryFn: api.listFolders,
    staleTime: 60_000,
  });
  const localFolders = useFolderStore((s) => s.folders);

  return React.useMemo<SidebarFolderData>(() => {
    const papers = papersQ.data ?? [];
    const folders = foldersQ.data ?? [];
    const statusCounts = Object.fromEntries(
      STATUS_FOLDERS.map((s) => [s.key, 0]),
    ) as Record<StatusFolderKey, number>;
    const venueCounts: Record<string, number> = {};
    let unfiledCount = 0;
    for (const p of papers) {
      const s = statusOf(p);
      if (s) statusCounts[s] += 1;
      if (p.folder) {
        venueCounts[p.folder] = (venueCounts[p.folder] ?? 0) + 1;
      } else {
        unfiledCount += 1;
      }
    }
    // Venue folders = the local store ∪ any folder labels surfaced on the
    // current paper list (covers freshly-uploaded papers whose folder isn't
    // in the store yet). "Inbox" is retired in v3 — strip if present.
    const venueSet = new Set<string>();
    for (const f of localFolders) {
      if (f && f !== "Inbox") venueSet.add(f);
    }
    for (const p of papers) {
      if (p.folder && p.folder !== "Inbox") venueSet.add(p.folder);
    }
    for (const f of folders) {
      if (f.name && f.name !== "Inbox") venueSet.add(f.name);
    }
    const folderMeta: Record<string, Folder> = {};
    for (const f of folders) folderMeta[f.name] = f;
    return {
      papers,
      statusCounts,
      venueFolders: Array.from(venueSet),
      venueCounts,
      folderMeta,
      unfiledCount,
      totalCount: papers.length,
    };
  }, [papersQ.data, foldersQ.data, localFolders]);
}

// ---------------------------------------------------------------------------
// Hierarchical grouping for the venue section.
// ---------------------------------------------------------------------------

/** Default venue groups in display order. Each one is a real default folder
 * on the backend (is_default=true) tagged with the matching venue_type, so
 * the parent row is itself a clickable filter. */
export const VENUE_GROUPS: { name: string; venue_type: VenueType }[] = [
  { name: "Journal", venue_type: "journal" },
  { name: "Conference", venue_type: "conference" },
  { name: "Grant", venue_type: "grant" },
  { name: "Thesis", venue_type: "thesis" },
];

export interface VenueTree {
  /** A parent venue group + the user-created folders that hang under it. */
  parents: {
    name: string;
    venue_type: VenueType;
    children: string[];
  }[];
  /** Folders that don't fit any parent (no venue_type set). Render flat. */
  orphans: string[];
}

/** Build the hierarchical render tree from `useSidebarFolders` output. */
export function buildVenueTree(
  venueFolders: string[],
  folderMeta: Record<string, Folder>,
): VenueTree {
  const used = new Set<string>();
  const parents = VENUE_GROUPS.map((g) => {
    used.add(g.name);
    const children = venueFolders
      .filter((n) => n !== g.name && folderMeta[n]?.venue_type === g.venue_type)
      .sort((a, b) => a.localeCompare(b));
    children.forEach((c) => used.add(c));
    return { name: g.name, venue_type: g.venue_type, children };
  });
  const orphans = venueFolders
    .filter((n) => !used.has(n))
    .sort((a, b) => a.localeCompare(b));
  return { parents, orphans };
}
