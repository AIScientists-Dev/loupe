/**
 * Capture the 7 frames that compose docs/screenshots/loupe-flow.gif.
 *
 * Prereq: dev server on :3009 with NEXT_PUBLIC_USE_MOCK=1.
 * Run:    node scripts/gif-frames.mjs
 *
 * Frames produced (numbered for ffmpeg input glob):
 *   1-landing.png            — papers list (light)
 *   2-upload.png             — upload dialog open
 *   3-triage.png             — paper card showing H/M/L verdict
 *   4-workspace.png          — PDF + findings panel with stripes
 *   5-investigate.png        — investigate thread on a finding
 *   6-review.png             — draft review modal
 *   7-dark.png               — same workspace with dark mode toggled
 */

import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.LOUPE_URL ?? "http://localhost:3009";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../docs/screenshots/gif-frames");
// The bundled test paper that backs the planted-bug fixture. MSW has no
// /pdf handler, so we stub the response in Playwright with these bytes.
const SAMPLE_PDF = resolve(HERE, "../../backend/tests/fixtures/sample_paper.pdf");

const VIEW = { width: 1440, height: 900 };

async function snap(page, name) {
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`📸 ${name}.png`);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    const r = document.documentElement;
    r.classList.remove("dark");
    if (t === "dark") r.classList.add("dark");
    try {
      localStorage.setItem("theme", t);
    } catch {}
  }, theme);
}

async function waitForMswReady(page) {
  await page.waitForFunction(
    () => !document.body.innerText.includes("Starting local mocks"),
    { timeout: 15_000 },
  );
}

async function closeAnyDialog(page) {
  // Loupe uses Radix Dialogs everywhere — multiple Escapes from body level
  // close them all without depending on focus.
  await page.locator("body").press("Escape").catch(() => {});
  await page.waitForTimeout(200);
  await page.locator("body").press("Escape").catch(() => {});
  await page.waitForTimeout(200);
}

async function dismissOnboarding(page) {
  // The Welcome-to-Loupe modal blocks every clickable surface on first
  // visit; complete it once via the "Get started" button (mock fixture's
  // venues are already filled, so the form is valid).
  const onboardingTitle = page.locator("text=Welcome to Loupe");
  if (!(await onboardingTitle.count())) return;
  const start = page
    .locator("button")
    .filter({ hasText: /Get started/i })
    .first();
  await start.click({ force: true }).catch(() => {});
  // Wait until it's actually detached.
  await onboardingTitle
    .first()
    .waitFor({ state: "detached", timeout: 5000 })
    .catch(() => {});
  await page.waitForTimeout(400);
}

async function clickThemeToggle(page) {
  // Sidebar theme toggle — sun/moon icon with aria-label "Toggle theme".
  const toggle = page
    .locator("button[aria-label*='theme' i], button[title*='theme' i]")
    .first();
  if (await toggle.count()) {
    await toggle.click().catch(() => {});
    return true;
  }
  return false;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });

  // Stub the onboarding endpoint so the welcome dialog stays dismissed
  // throughout the captures (mock fixtures don't ship a handler for it).
  await ctx.route("**/v1/onboarding", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "Reviewer",
        role: "Faculty",
        field: "Statistics",
        research_interests: [],
        default_venues: ["JASA"],
        default_review_style: { style: "rigorous_skeptical" },
        completed_at: "2026-04-29T00:00:00Z",
      }),
    });
  });

  // Stub the PDF endpoint with the bundled sample paper so the workspace
  // renders the actual document instead of "Could not load PDF".
  const pdfBytes = await readFile(SAMPLE_PDF);
  await ctx.route("**/v1/papers/*/pdf", (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/pdf",
      body: pdfBytes,
    });
  });

  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.error("[pageerror]", e.message));

  // -------- Frame 1: landing (light) --------
  await page.goto(`${BASE}/papers`);
  await waitForMswReady(page);
  await setTheme(page, "light");
  await dismissOnboarding(page);
  // Wait for actual paper cards to render — skeleton loaders show until
  // React Query returns from the mocked /papers handler.
  await page
    .locator('a[href^="/papers/"]')
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  await snap(page, "1-landing");

  // -------- Frame 2: upload dialog open --------
  const uploadBtn = page
    .locator("button")
    .filter({ hasText: /Upload (paper|your first paper)/i })
    .first();
  await uploadBtn.click().catch(() => {});
  await page.waitForTimeout(500);
  await snap(page, "2-upload");

  // Hard reset to library — Radix overlays sometimes linger on Escape.
  await page.goto(`${BASE}/papers`);
  await waitForMswReady(page);
  await setTheme(page, "light");
  await page
    .locator('a[href^="/papers/"]')
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .catch(() => {});
  await page.waitForTimeout(400);

  // -------- Frame 3: library with triage verdicts --------
  await snap(page, "3-triage");

  // -------- Frame 4: workspace (PDF + findings split view) --------
  // Hard-navigate rather than relying on a card-click selector — fixture
  // IDs are stable in mock mode.
  await page.goto(`${BASE}/papers/pap_planted5`);
  await waitForMswReady(page);
  await setTheme(page, "light");
  // Stage="dived" lands on the score-summary view; click into the PDF +
  // findings split (the more visually interesting workspace shot).
  await page
    .locator("button")
    .filter({ hasText: /Adjust by reviewing findings/i })
    .first()
    .click({ force: true })
    .catch(() => {});
  await page.waitForTimeout(1500);
  await snap(page, "4-workspace");

  // -------- Frame 5: investigate thread --------
  const allInv = page.locator("button:has-text('Investigate')");
  const invTotal = await allInv.count();
  console.log(`  investigate buttons found: ${invTotal}`);
  // Click the first Investigate within the findings panel.
  await allInv.first().scrollIntoViewIfNeeded().catch(() => {});
  await allInv.first().click({ force: true }).catch((e) => {
    console.log(`  investigate click failed: ${e.message}`);
  });
  // Wait for the panel to render — the chips are the canonical signal.
  await page
    .locator("text=/Re-derive this step|Find a counterexample/")
    .first()
    .waitFor({ state: "visible", timeout: 4000 })
    .catch((e) => console.log(`  investigate panel did not appear: ${e.message}`));
  await page.waitForTimeout(500);
  await snap(page, "5-investigate");

  // -------- Frame 6: review draft modal --------
  // pap_reviewed has 1 finding already decided → "Generate review" in the
  // findings panel is enabled, which opens DraftReviewDialog (the modal we
  // want, not the toast that fires from the summary-view button).
  await page.goto(`${BASE}/papers/pap_reviewed`);
  await waitForMswReady(page);
  await setTheme(page, "light");
  await page.waitForTimeout(800);
  // Enter the split view.
  await page
    .locator("button")
    .filter({ hasText: /Adjust by reviewing findings/i })
    .first()
    .click({ force: true })
    .catch(() => {});
  await page.waitForTimeout(1200);
  // The findings-panel "Generate review" button (small, in the footer).
  const genReview = page
    .locator("button")
    .filter({ hasText: /^\s*Generate review\s*$/i })
    .first();
  const genCount = await genReview.count();
  console.log(`  generate-review buttons: ${genCount}`);
  await genReview.click({ force: true }).catch((e) => {
    console.log(`  generate-review click failed: ${e.message}`);
  });
  // Wait for the dialog content to mount (Radix renders [role=dialog]).
  await page
    .locator("[role=dialog]")
    .first()
    .waitFor({ state: "visible", timeout: 6000 })
    .catch((e) => console.log(`  review dialog did not appear: ${e.message}`));
  await page.waitForTimeout(800);
  await snap(page, "6-review");
  await closeAnyDialog(page);

  // -------- Frame 7: dark mode (clicked, not DOM-forced) --------
  // The theme toggle opens a dropdown menu (Light / Dark / System); the
  // toggle alone doesn't switch — we have to click the "Dark" item.
  const clicked = await clickThemeToggle(page);
  if (clicked) {
    await page.waitForTimeout(300);
    await page
      .getByRole("menuitem", { name: /dark/i })
      .first()
      .click({ force: true })
      .catch(async () => {
        // Fallback: any visible button/anchor whose text is exactly "Dark".
        await page
          .locator("button, [role=menuitem]")
          .filter({ hasText: /^\s*Dark\s*$/i })
          .first()
          .click({ force: true })
          .catch(() => {});
      });
  } else {
    // Last-resort fallback so the GIF still has a dark frame.
    await setTheme(page, "dark");
  }
  await page.waitForTimeout(800);
  await snap(page, "7-dark");

  await browser.close();
  console.log(`\nFrames → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
