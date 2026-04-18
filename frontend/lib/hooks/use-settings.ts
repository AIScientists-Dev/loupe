"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type AppSettings = {
  /** Per-paper budget cap in USD. Sent to backend on upload. */
  defaultBudgetCapUsd: number;
  /** Include figures-appendix pages in analysis. Default: false (skipped). */
  includeFiguresAppendix: boolean;
  /** Override the default LLM provider (empty = backend default). */
  defaultModel: string;
};

type Store = AppSettings & {
  setBudgetCap: (v: number) => void;
  setIncludeFigures: (v: boolean) => void;
  setDefaultModel: (v: string) => void;
  reset: () => void;
};

const DEFAULTS: AppSettings = {
  defaultBudgetCapUsd: 1.5,
  includeFiguresAppendix: false,
  defaultModel: "",
};

export const useSettings = create<Store>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setBudgetCap: (v) => set({ defaultBudgetCapUsd: v }),
      setIncludeFigures: (v) => set({ includeFiguresAppendix: v }),
      setDefaultModel: (v) => set({ defaultModel: v }),
      reset: () => set(DEFAULTS),
    }),
    {
      name: "loupe.settings.v1",
      storage: createJSONStorage(() => localStorage),
    }
  )
);
