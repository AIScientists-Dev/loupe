import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto("http://localhost:3009/papers/1e500286-d410-4d60-8ed3-be2c8b727d66", {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector("[data-page]", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: "/tmp/fix-p1.png" });

// Scroll to page 2
const scroller = await page.evaluateHandle(() =>
  document.querySelector('[data-page]')?.closest('[class*="overflow-y-auto"]')
);
await page.mouse.move(500, 400);
await page.mouse.wheel(0, 800);
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: "/tmp/fix-p2.png" });

await browser.close();
