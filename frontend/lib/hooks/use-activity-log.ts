"use client";

import { create } from "zustand";

export type ActivityEvent = {
  id: string;
  paperId: string;
  ts: number;
  kind: "outline" | "segment" | "finding" | "localize" | "cost" | "run" | "step";
  message: string;
};

type State = {
  // Per-paper ring buffer (latest first). Capped to keep memory bounded.
  events: Record<string, ActivityEvent[]>;
  push: (paperId: string, kind: ActivityEvent["kind"], message: string) => void;
  clear: (paperId: string) => void;
};

const MAX_EVENTS_PER_PAPER = 60;
let _uidCounter = 0;
const uid = () => {
  _uidCounter = (_uidCounter + 1) | 0;
  return `${Date.now().toString(36)}-${_uidCounter.toString(36)}`;
};

export const useActivityLog = create<State>((set) => ({
  events: {},
  push: (paperId, kind, message) =>
    set((s) => {
      const prev = s.events[paperId] ?? [];
      const next = [
        { id: uid(), paperId, ts: Date.now(), kind, message },
        ...prev,
      ].slice(0, MAX_EVENTS_PER_PAPER);
      return { events: { ...s.events, [paperId]: next } };
    }),
  clear: (paperId) =>
    set((s) => {
      if (!s.events[paperId]) return s;
      const next = { ...s.events };
      delete next[paperId];
      return { events: next };
    }),
}));
