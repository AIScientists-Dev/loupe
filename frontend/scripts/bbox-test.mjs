import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:3009/papers/1e500286-d410-4d60-8ed3-be2c8b727d66", {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector("[data-page]", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 4000));

// Scroll directly to page 29 via click on a finding card
const targetPage = 29;
await page.evaluate((pg) => {
  const el = document.querySelector(`[data-page="${pg}"]`);
  el?.scrollIntoView({ block: "start" });
}, targetPage);
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: "/tmp/pdf-p29.png" });

// Page 30
await page.evaluate(() => {
  const el = document.querySelector(`[data-page="30"]`);
  el?.scrollIntoView({ block: "start" });
});
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: "/tmp/pdf-p30.png" });

await browser.close();
