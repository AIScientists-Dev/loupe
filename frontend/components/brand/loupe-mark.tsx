import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Loupe mark — real asset from the brand pack.
 * Swaps light/dark via Tailwind variants (never filter-invert, which
 * would corrupt the emerald primary).
 */
export function LoupeMark({
  size = 24,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/mark/mark.svg"
        width={size}
        height={size}
        alt=""
        className="block dark:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/mark/mark-dark.svg"
        width={size}
        height={size}
        alt=""
        className="hidden dark:block"
      />
    </span>
  );
}

/** Animated mark for splash / first load. 6s SMIL loop baked in. */
export function LoupeMarkAnimated({
  size = 48,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/mark/mark-animated.svg"
        width={size}
        height={size}
        alt="Loupe"
      />
    </span>
  );
}

/**
 * Loupe lockup (mark + wordmark) for sidebar / headers.
 * Use for anywhere with horizontal room for the wordmark.
 */
export function LoupeLockup({
  height = 32,
  withTagline = false,
  className,
}: {
  height?: number;
  withTagline?: boolean;
  className?: string;
}) {
  const lightSrc = withTagline
    ? "/brand/lockup/lockup-horizontal-tagline.svg"
    : "/brand/lockup/lockup-horizontal.svg";
  const darkSrc = withTagline
    ? "/brand/lockup/lockup-horizontal-tagline-dark.svg"
    : "/brand/lockup/lockup-horizontal-dark.svg";
  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ height }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={lightSrc}
        height={height}
        alt="Loupe"
        className="block h-full w-auto dark:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={darkSrc}
        height={height}
        alt="Loupe"
        className="hidden h-full w-auto dark:block"
      />
    </span>
  );
}
