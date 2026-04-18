/**
 * Capture README screenshots of the Loupe UI.
 *
 * Prereq: dev server running on :3009 with NEXT_PUBLIC_USE_MOCK=1.
 * Run:    npm run screenshots
 *
 * Produces:
 *   docs/screenshots/papers-list.png
 *   docs/screenshots/analysis-progress.png
 *   docs/screenshots/workspace.png
 *   docs/screenshots/draft-review.png
 *   docs/screenshots/papers-list-dark.png
 *   docs/screenshots/workspace-dark.png
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.LOUPE_URL ?? "http://localhost:3009";
const OUT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/screenshots"
);

const VIEWPORT = { width: 1440, height: 900 };

async function ensureDir() {
  await mkdir(OUT_DIR, { recursive: true });
}

async function waitForMswReady(page) {
  // The MSW splash shows "Starting local mocks…"; when it clears we know
  // the worker has booted.
  await page.waitForFunction(
    () => !document.body.innerText.includes("Starting local mocks"),
    { timeout: 15_000 }
  );
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

async function snap(page, name) {
  const path = resolve(OUT_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  console.log(`✓ ${name}.png`);
}

async function main() {
  await ensureDir();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // @2x for sharper README
  });
  const page = await ctx.newPage();

  // 1. Papers list — light
  await page.goto(`${BASE}/papers`, { waitUntil: "networkidle" });
  await waitForMswReady(page);
  await page.waitForSelector("text=Sharp Concentration", { timeout: 10_000 });
  await page.waitForTimeout(400);
  await snap(page, "papers-list");

  // 1b. Papers list — dark
  await setTheme(page, "dark");
  await page.waitForTimeout(200);
  await snap(page, "papers-list-dark");
  await setTheme(page, "light");

  // 2. Workspace (ready paper with 5 findings) — light
  await page.goto(`${BASE}/papers/pap_planted5`, { waitUntil: "networkidle" });
  await waitForMswReady(page);
  await page.waitForSelector("blockquote", { timeout: 8_000 }); // first finding's quote rendered
  await page.waitForTimeout(1200); // let KaTeX finish typesetting
  await snap(page, "workspace");

  // 2b. Workspace — dark
  await setTheme(page, "dark");
  await page.waitForTimeout(300);
  await snap(page, "workspace-dark");
  await setTheme(page, "light");

  // 3. Draft review modal — decide all findings by keyboard then Generate.
  // 'a' fires immediate Agree per our keyboard shortcuts.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("a");
    await page.waitForTimeout(320);
    await page.keyboard.press("j");
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  const genBtn = page.getByRole("button", { name: /Generate review/ });
  if (await genBtn.isEnabled()) {
    await genBtn.click();
    await page.waitForSelector("text=Draft review", { timeout: 5_000 });
    await page.waitForTimeout(1700); // mock generation delay
    await snap(page, "draft-review");
    // close modal before moving on
    await page.keyboard.press("Escape");
  } else {
    console.log("⚠ skipping draft-review (not all findings decided)");
  }

  // 4. Analysis progress — upload a PDF and catch the progress view
  await page.goto(`${BASE}/papers`, { waitUntil: "networkidle" });
  await waitForMswReady(page);

  // Fake a tiny PDF and drop it into the dropzone.
  await page.getByRole("button", { name: /Upload paper/ }).click();
  const tinyPdf = Buffer.from("%PDF-1.4\n%mock-loupe\n");
  const fileInput = page.locator("input[type=file]");
  await fileInput.setInputFiles({
    name: "demo.pdf",
    mimeType: "application/pdf",
    buffer: tinyPdf,
  });
  // URL will navigate to /papers/<new-id> automatically.
  await page.waitForURL(/\/papers\/pap_/, { timeout: 5_000 });
  // The analysis-progress view renders while status !== ready. Wait for
  // the second step to light up so we capture a mid-pipeline moment.
  await page.waitForSelector("text=Extract proofs", { timeout: 5_000 });
  await page.waitForTimeout(4_500); // land on step 2
  await snap(page, "analysis-progress");

  await browser.close();
  console.log(`\nAll screenshots saved to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
