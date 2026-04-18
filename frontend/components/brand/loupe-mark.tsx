import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Placeholder mark for Loupe — a jeweler's-loupe silhouette (lens + short handle).
 * Swap with the final asset from brand/ when it lands.
 */
export function LoupeMark({
  className,
  size = 24,
  ...props
}: React.SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("text-primary", className)}
      aria-hidden="true"
      {...props}
    >
      <circle
        cx="13"
        cy="13"
        r="8.5"
        stroke="currentColor"
        strokeWidth="2.2"
        fill="none"
      />
      <circle cx="13" cy="13" r="3.5" fill="currentColor" opacity="0.18" />
      <line
        x1="19.4"
        y1="19.4"
        x2="26.5"
        y2="26.5"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function LoupeWordmark({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LoupeMark size={22} />
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        Loupe
      </span>
    </div>
  );
}
