"use client";

import { create } from "zustand";

type State = {
  open: boolean;
  toggle: () => void;
  setOpen: (v: boolean) => void;
};

export const useCostDrawer = create<State>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (v) => set({ open: v }),
}));
