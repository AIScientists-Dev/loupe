import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:3009/papers/1e500286-d410-4d60-8ed3-be2c8b727d66", {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector("[data-page]", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 800));

const chain = await page.evaluate(() => {
  const result = [];
  let el = document.querySelector('[data-page]')?.closest('[class*="overflow-y-auto"]');
  while (el && el !== document.documentElement) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    result.push({
      tag: el.tagName,
      cls: (el.className ?? "").toString(),
      h: Math.round(r.height),
      display: cs.display,
      flex: cs.flex,
      minH: cs.minHeight,
      overflow: cs.overflow,
    });
    el = el.parentElement;
  }
  return result;
});
console.log(JSON.stringify(chain, null, 2));
await browser.close();
