"use client";

import { create } from "zustand";

type State = {
  open: boolean;
  sectionId: string | null;
  termId: string | null;
  openAt: (sectionId?: string, termId?: string) => void;
  close: () => void;
  toggle: () => void;
};

export const useGlossary = create<State>((set) => ({
  open: false,
  sectionId: null,
  termId: null,
  openAt: (sectionId, termId) =>
    set({
      open: true,
      sectionId: sectionId ?? null,
      termId: termId ?? null,
    }),
  close: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
