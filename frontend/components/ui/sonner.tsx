"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

export function Toaster(props: React.ComponentProps<typeof Sonner>) {
  const { theme = "system" } = useTheme();
  return (
    <Sonner
      theme={theme as "light" | "dark" | "system"}
      className="toaster group"
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border",
          description: "group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
