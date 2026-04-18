/**
 * Brand asset paths. Swap these when the Claude Design pack lands in
 * public/brand/. Until then the app falls back to the placeholder
 * LoupeMark component.
 */
export const BRAND = {
  markLight: "/brand/mark/mark.svg",
  markDark: "/brand/mark/mark-dark.svg",
  markAnimated: "/brand/mark/mark-animated.svg",
  lockupHorizontal: "/brand/lockup/lockup-horizontal.svg",
  lockupHorizontalDark: "/brand/lockup/lockup-horizontal-dark.svg",
  lockupTagline: "/brand/lockup/lockup-horizontal-tagline.svg",
  lockupTaglineDark: "/brand/lockup/lockup-horizontal-tagline-dark.svg",
  decorEmptyState: "/brand/decor/empty-state-decor.svg",
  ogCard: "/brand/social/og-card-1200x630.png",
  readmeBanner: "/brand/social/readme-banner-1280x320.png",
  issueIcon: (type: string) => `/icons/issue-types/${type}.svg`,
} as const;
