"use client";

import { create } from "zustand";

type State = {
  open: boolean;
  setOpen: (v: boolean) => void;
  openDialog: () => void;
  close: () => void;
};

export const useSettingsDialog = create<State>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
  openDialog: () => set({ open: true }),
  close: () => set({ open: false }),
}));
