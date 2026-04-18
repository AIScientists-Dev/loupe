"use client";

import * as React from "react";

import { LoupeMarkAnimated } from "@/components/brand/loupe-mark";

let started = false;

async function start() {
  if (started) return;
  started = true;
  const { worker } = await import("@/mocks/browser");
  await worker.start({
    onUnhandledRequest: "bypass",
    serviceWorker: { url: "/mockServiceWorker.js" },
  });
}

export function MswBoot({ children }: { children: React.ReactNode }) {
  const useMock = process.env.NEXT_PUBLIC_USE_MOCK === "1";
  const [ready, setReady] = React.useState(!useMock);

  React.useEffect(() => {
    if (useMock) start().then(() => setReady(true));
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
