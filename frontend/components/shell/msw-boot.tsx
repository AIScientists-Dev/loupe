"use client";

import * as React from "react";

import { LoupeMarkAnimated } from "@/components/brand/loupe-mark";

let started = false;
const RELOADED_KEY = "loupe-msw-reloaded";

async function start() {
  if (started) return;
  started = true;
  const { worker } = await import("@/mocks/browser");
  await worker.start({
    onUnhandledRequest: "warn",
    serviceWorker: { url: "/mockServiceWorker.js" },
  });

  // MSW v2 race: even after worker.start() resolves, the current page may
  // not yet be controlled by the service worker (clients.claim has a short
  // propagation delay). Any fetch made in the first few ticks can bypass
  // the mock and hit the real backend. Force a one-time reload so the
  // subsequent page load comes up under the worker's control.
  // Guarded via sessionStorage so it fires at most once per tab session.
  if (typeof sessionStorage !== "undefined") {
    if (!sessionStorage.getItem(RELOADED_KEY)) {
      sessionStorage.setItem(RELOADED_KEY, "1");
      window.location.reload();
      // Never resolve — the reload takes it from here.
      await new Promise(() => {});
    }
  }
}

export function MswBoot({ children }: { children: React.ReactNode }) {
  const useMock = process.env.NEXT_PUBLIC_USE_MOCK === "1";
  // When mocks are off we render immediately — no reason to hold paint
  // behind a serviceWorker lookup. When mocks are on we start hidden so
  // queries don't leak through before the worker is registered.
  const [ready, setReady] = React.useState(!useMock);

  React.useEffect(() => {
    if (useMock) {
      start()
        .then(() => setReady(true))
        .catch(() => setReady(true));
      return;
    }
    // Fire-and-forget: if a previous mock session left a worker behind,
    // unregister it so it stops intercepting real backend requests. The
    // current page is already painted; we only need to reload if a stale
    // worker is actually found.
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        const mswRegs = regs.filter((r) =>
          (r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || "")
            .includes("mockServiceWorker")
        );
        if (!mswRegs.length) return;
        return Promise.all(mswRegs.map((r) => r.unregister())).then(() => {
          if (typeof sessionStorage !== "undefined" &&
              !sessionStorage.getItem("loupe-msw-unregistered")) {
            sessionStorage.setItem("loupe-msw-unregistered", "1");
            window.location.reload();
          }
        });
      })
      .catch(() => undefined);
  }, [useMock]);

  if (!ready) return <Splash />;
  return <>{children}</>;
}

function Splash() {
  return (
    <div className="grid h-screen w-full place-items-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <LoupeMarkAnimated size={56} />
        <div className="text-sm font-medium tracking-tight text-foreground">
          Loupe
        </div>
        <div className="text-xs text-muted-foreground">Starting local mocks…</div>
      </div>
    </div>
  );
}
