"use client";

import * as React from "react";

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
  const [ready, setReady] = React.useState(
    process.env.NEXT_PUBLIC_USE_MOCK !== "1"
  );

  React.useEffect(() => {
    if (process.env.NEXT_PUBLIC_USE_MOCK === "1") {
      start().then(() => setReady(true));
    }
  }, []);

  if (!ready) return null;
  return <>{children}</>;
}
