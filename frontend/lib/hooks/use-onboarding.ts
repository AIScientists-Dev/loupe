"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import { api } from "@/lib/api";
import type { OnboardingProfile } from "@/lib/types";

const STORAGE_KEY = "loupe.onboarding.v1";

type State = {
  /** Server-canonical profile (mirrored to localStorage as offline cache).
   * `null` until either the server returns 404 (not yet completed) OR the
   * user submits the form. `undefined` means we haven't yet checked. */
  profile: OnboardingProfile | null;
  hydrated: boolean;
  setProfile: (p: OnboardingProfile | null) => void;
  reset: () => void;
};

function load(): OnboardingProfile | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OnboardingProfile;
    if (!parsed.completed_at) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist(p: OnboardingProfile | null) {
  if (typeof window === "undefined") return;
  try {
    if (p) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore quota
  }
}

export const useOnboarding = create<State>((set) => ({
  profile: typeof window === "undefined" ? null : load(),
  hydrated: false,
  setProfile: (p) => {
    persist(p);
    set({ profile: p, hydrated: true });
  },
  reset: () => {
    persist(null);
    set({ profile: null });
  },
}));

/**
 * Hydrate the onboarding store from `GET /v1/onboarding`. Mount once at the
 * shell level (sidebar). On 404 the API client returns null — we update the
 * store so consumers know the user hasn't onboarded yet without further
 * round-trips.
 */
export function useOnboardingHydration() {
  const setProfile = useOnboarding((s) => s.setProfile);
  const q = useQuery({
    queryKey: ["onboarding"],
    queryFn: api.getOnboarding,
    staleTime: 60_000,
  });
  React.useEffect(() => {
    if (q.isSuccess) setProfile(q.data ?? null);
  }, [q.isSuccess, q.data, setProfile]);
}

/**
 * Submit the onboarding form. POSTs to /v1/onboarding (which seeds folders
 * on first call), updates the store with the server response, and refreshes
 * the folders cache so the sidebar reflects the seeded venues.
 */
export function useSubmitOnboarding() {
  const qc = useQueryClient();
  const setProfile = useOnboarding((s) => s.setProfile);
  return React.useCallback(
    async (
      input: Omit<OnboardingProfile, "completed_at">,
    ): Promise<OnboardingProfile> => {
      const profile = await api.submitOnboarding(input);
      setProfile(profile);
      qc.invalidateQueries({ queryKey: ["folders"] });
      qc.invalidateQueries({ queryKey: ["onboarding"] });
      return profile;
    },
    [qc, setProfile],
  );
}
