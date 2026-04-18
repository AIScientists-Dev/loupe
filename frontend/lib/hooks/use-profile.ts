"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

/**
 * Dummy local "account". Loupe has no real auth today — this just backs
 * the avatar / settings UI so the surface is in place when real auth lands.
 */
export type Profile = {
  name: string;
  email: string;
  signedIn: boolean;
};

type Store = Profile & {
  update: (p: Partial<Profile>) => void;
  signIn: (name: string, email: string) => void;
  signOut: () => void;
};

const DEFAULTS: Profile = {
  name: "Anonymous Reviewer",
  email: "",
  signedIn: false,
};

export const useProfile = create<Store>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      update: (p) => set(p),
      signIn: (name, email) => set({ name, email, signedIn: true }),
      signOut: () => set(DEFAULTS),
    }),
    {
      name: "loupe.profile.v1",
      storage: createJSONStorage(() => localStorage),
    }
  )
);

/** DiceBear-style initials for the avatar — deterministic from email/name. */
export function initialsFor(p: Profile): string {
  const src = p.email || p.name || "?";
  const parts = src
    .replace(/[^a-zA-Z\s]/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 2);
  return parts.map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
}
