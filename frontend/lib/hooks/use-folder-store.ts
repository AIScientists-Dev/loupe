"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import { api } from "@/lib/api";
import type { VenueType } from "@/lib/types";

const STORAGE_KEY = "loupe.folders.v1";

type State = {
  /** Local source of truth for the folder list. Seeded from /v1/folders on
   * first load; mutations go through this store and sync to the backend
   * (or, until /folders POST/PATCH/DELETE land, just to localStorage). */
  folders: string[];
  hydrate: (server: string[]) => void;
  add: (name: string) => boolean;     // false on duplicate
  rename: (oldName: string, newName: string) => boolean;
  remove: (name: string) => void;
};

function load(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string" && x !== "Inbox") : [];
  } catch {
    return [];
  }
}

function persist(list: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    // ignore quota
  }
}

export const useFolderStore = create<State>((set, get) => ({
  folders: typeof window === "undefined" ? [] : load(),

  /** Merge server-provided folder *names* into the local store. v3
   * backend returns Folder records — caller passes in the names. Idempotent;
   * preserves any local entries not yet acknowledged by the server. */
  hydrate: (server) => {
    const merged = new Set<string>(get().folders);
    for (const f of server) {
      if (f && f !== "Inbox") merged.add(f);
    }
    const next = Array.from(merged);
    persist(next);
    set({ folders: next });
  },

  add: (name) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (trimmed === "Inbox") return false;
    if (get().folders.includes(trimmed)) return false;
    const next = [...get().folders, trimmed];
    persist(next);
    set({ folders: next });
    return true;
  },

  rename: (oldName, newName) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return false;
    const list = get().folders;
    if (!list.includes(oldName)) return false;
    if (list.includes(trimmed)) return false;
    const next = list.map((f) => (f === oldName ? trimmed : f));
    persist(next);
    set({ folders: next });
    return true;
  },

  remove: (name) => {
    const next = get().folders.filter((f) => f !== name);
    persist(next);
    set({ folders: next });
  },
}));

/**
 * Hydrate the folder store from /v1/folders on mount. Call once at the app
 * shell level; subsequent components read from useFolderStore directly.
 *
 * The store also captures any folders surfaced by the React Query "folders"
 * cache (so optimistic upload-time additions show up in the sidebar without
 * a refetch).
 */
export function useFolderHydration() {
  const hydrate = useFolderStore((s) => s.hydrate);
  const q = useQuery({
    queryKey: ["folders"],
    queryFn: api.listFolders,
    staleTime: 60_000,
  });
  React.useEffect(() => {
    if (q.data) hydrate(q.data.map((f) => f.name));
  }, [q.data, hydrate]);
}

/**
 * v3: folder rename/delete cascades on the backend (PATCH/DELETE /folders
 * walks paper.folder for every matching paper). Frontend no longer needs
 * to issue a per-paper PATCH /folder loop — the cascade is server-side.
 *
 * The local zustand store remains as an optimistic cache so the sidebar
 * updates instantly while the backend call is in flight.
 */
export function useFolderMutations() {
  const qc = useQueryClient();
  const add = useFolderStore((s) => s.add);
  const rename = useFolderStore((s) => s.rename);
  const remove = useFolderStore((s) => s.remove);

  const refreshAfter = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: ["folders"] });
    qc.invalidateQueries({ queryKey: ["papers", "list"] });
  }, [qc]);

  const create = React.useCallback(
    async (name: string, venue_type?: VenueType): Promise<boolean> => {
      const okLocal = add(name);
      if (!okLocal) return false;
      try {
        await api.createFolder(name, venue_type);
      } catch (e) {
        // Backend rejected (likely 409 duplicate). Roll the optimistic add
        // back so the sidebar reflects the truth.
        remove(name);
        throw e;
      }
      refreshAfter();
      return true;
    },
    [add, remove, refreshAfter],
  );

  const setVenueType = React.useCallback(
    async (name: string, venue_type: VenueType | null): Promise<boolean> => {
      try {
        await api.setFolderVenueType(name, venue_type);
      } catch {
        return false;
      }
      refreshAfter();
      return true;
    },
    [refreshAfter],
  );

  const renameFolder = React.useCallback(
    async (oldName: string, newName: string): Promise<boolean> => {
      const okLocal = rename(oldName, newName);
      if (!okLocal) return false;
      try {
        await api.renameFolder(oldName, newName);
      } catch (e) {
        // Roll back the local rename so the sidebar isn't out of sync.
        rename(newName, oldName);
        throw e;
      }
      refreshAfter();
      return true;
    },
    [rename, refreshAfter],
  );

  const deleteFolder = React.useCallback(
    async (name: string): Promise<boolean> => {
      // Optimistic local removal first so the sidebar disappears the row.
      remove(name);
      try {
        await api.deleteFolder(name);
      } catch (e) {
        // On failure (e.g. is_default), re-add locally so sidebar reflects
        // the truth. Caller can also surface a toast off the throw.
        add(name);
        throw e;
      }
      refreshAfter();
      return true;
    },
    [remove, add, refreshAfter],
  );

  return { create, renameFolder, deleteFolder, setVenueType };
}
