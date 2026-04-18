"use client";

import * as React from "react";

export type Hotkey = {
  keys: string[]; // e.g. ["j", "ArrowDown"]
  handler: (e: KeyboardEvent) => void;
  allowInInput?: boolean;
};

function isEditableTarget(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Register keyboard shortcuts scoped to window. Skips when user is typing
 * in any input/textarea/contenteditable unless the hotkey opts in via
 * `allowInInput: true`.
 */
export function useHotkeys(hotkeys: Hotkey[], enabled = true) {
  React.useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const editable = isEditableTarget(e);
      for (const hk of hotkeys) {
        if (editable && !hk.allowInInput) continue;
        if (hk.keys.some((k) => k === e.key)) {
          hk.handler(e);
          return;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [hotkeys, enabled]);
}
