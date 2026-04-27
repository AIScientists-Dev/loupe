"use client";

import { create } from "zustand";

type State = {
  /** True while the user is in batch-select mode (the library shows
   * checkboxes on every card and a floating action bar at the bottom). */
  active: boolean;
  /** Currently selected paper IDs. */
  selected: Set<string>;
  enter: () => void;
  exit: () => void;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
  has: (id: string) => boolean;
};

/**
 * Library batch-select state. Lives in zustand (not URL) so the floating
 * action bar can read selected IDs without prop drilling, and the cards
 * react to selection changes without re-rendering the whole grid.
 */
export const useBatchSelect = create<State>((set, get) => ({
  active: false,
  selected: new Set(),
  enter: () => set({ active: true, selected: new Set() }),
  exit: () => set({ active: false, selected: new Set() }),
  toggle: (id) =>
    set((s) => {
      const next = new Set(s.selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { selected: next };
    }),
  selectAll: (ids) => set({ selected: new Set(ids) }),
  clear: () => set({ selected: new Set() }),
  has: (id) => get().selected.has(id),
}));
