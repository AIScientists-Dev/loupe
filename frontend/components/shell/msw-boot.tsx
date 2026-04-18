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
  // Always start hidden until effect resolves — avoids any server/client
  // mismatch or stale-bundle fallback that leaks queries through before
  // the worker is registered.
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[loupe] MswBoot effect: useMock=", useMock);
    if (useMock) {
      start()
        .then(() => {
          // eslint-disable-next-line no-console
          console.log("[loupe] MSW worker ready — fixtures active");
          setReady(true);
        })
        .catch((err) => {
          // eslint-disable-next-line no-console
          console.error("[loupe] MSW boot failed, falling through", err);
          setReady(true);
        });
    } else {
      setReady(true);
    }
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
