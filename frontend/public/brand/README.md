# Loupe brand assets

This directory is the **drop zone** for brand assets produced by Claude Design.

When the `loupe-brand/` pack is delivered, copy the files into this tree
**exactly** as shown. The frontend reads from these paths via constants in
`@/lib/brand.ts` — no component code needs to change on swap.

## Expected tree

```
public/brand/
├── mark/
│   ├── mark.svg                  # primary, emerald-on-transparent
│   ├── mark-dark.svg             # inverse, for dark backgrounds
│   ├── mark-mono-black.svg
│   ├── mark-mono-white.svg
│   └── mark-animated.svg         # 6s ring rotation (used on splash)
├── lockup/
│   ├── lockup-horizontal.svg
│   ├── lockup-horizontal-dark.svg
│   ├── lockup-horizontal-tagline.svg
│   ├── lockup-horizontal-tagline-dark.svg
│   ├── lockup-stacked.svg
│   └── lockup-stacked-dark.svg
├── decor/
│   └── empty-state-decor.svg     # /papers empty state illustration
└── social/
    ├── og-card-1200x630.png
    └── readme-banner-1280x320.png
```

Separately:

```
public/
├── favicon.ico
├── apple-touch-icon.png
├── android-chrome-192.png
├── android-chrome-512.png
└── manifest.webmanifest

public/icons/issue-types/
├── arithmetic.svg
├── logic.svg
├── unstated_assumption.svg
├── wrong_constant.svg
├── quantifier_scope.svg
├── citation_required.svg
├── definition_mismatch.svg
├── missing_step.svg
└── other.svg
```

After dropping files in:

1. Replace the placeholder LoupeMark component in
   `components/brand/loupe-mark.tsx` with an `<img src={BRAND.markLight} />`
   (or `next/image` for optimization).
2. In `components/shell/sidebar.tsx`, swap the inline mark for
   `<img src={BRAND.lockupHorizontal} />` and bump the header size.
3. In `components/workspace/issue-type.ts`, point each `issue_type` to its
   SVG file in `public/icons/issue-types/` (keep `stroke=currentColor` so
   severity colors still apply via CSS).
4. In `app/layout.tsx`, update the `<head>` icons to reference the new
   favicon set and add `<link rel="manifest" href="/manifest.webmanifest" />`.
5. In `app/papers/page.tsx`, replace the empty-state tile with
   `<img src="/brand/decor/empty-state-decor.svg" />`.

## Guardrails (from the brand spec)

- Do NOT fill the lens — the transparent lens is the brand.
- Do NOT place the emerald mark on backgrounds darker than `#3B7A6B` —
  switch to `mark-dark.svg`.
- Issue-type SVGs must keep `stroke=currentColor` so they recolor by
  severity (high/medium/low) via CSS.
