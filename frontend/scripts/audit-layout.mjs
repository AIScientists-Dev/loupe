import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const OUT = "/tmp/loupe-audit";
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

async function snap(url, name, opts = {}) {
  await page.goto(`http://localhost:3009${url}`, { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, opts.wait ?? 2500));
  if (opts.before) await opts.before(page);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: opts.full ?? false });
  console.log(`✓ ${name}`);
}

await snap("/papers", "01-papers-list");
await snap("/papers", "02-papers-hover", {
  before: async (p) => {
    const card = await p.$('[data-slot="paper-card"], article, .group');
    if (card) await card.hover();
    await new Promise((r) => setTimeout(r, 400));
  },
});
await snap("/papers/pap_planted5", "03-workspace-closed-drawer", { wait: 3500 });
await snap("/papers/pap_planted5", "04-workspace-open-drawer", {
  wait: 3500,
  before: async (p) => {
    const btn = await p.$('button[aria-expanded][aria-controls="cost-drawer-body"]');
    if (btn) await btn.click();
    await new Promise((r) => setTimeout(r, 500));
  },
});
await snap("/share/pap_planted5", "05-share-view", { wait: 3500 });

await browser.close();
