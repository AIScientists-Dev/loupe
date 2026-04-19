import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:3009/papers/1e500286-d410-4d60-8ed3-be2c8b727d66", {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector("[data-page]", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1500));

async function activePage() {
  return await page.evaluate(() => {
    const active = document.querySelector("button[aria-label^='Page'][class*='ring-2']");
    if (!active) return null;
    const label = active.getAttribute("aria-label") || "";
    return label.match(/Page (\d+)/)?.[1] ?? null;
  });
}

console.log("Initial active thumbnail:", await activePage());

await page.mouse.move(500, 400);
for (let i = 0; i < 4; i++) {
  await page.mouse.wheel(0, 800);
  await new Promise((r) => setTimeout(r, 300));
  console.log(`After wheel step ${i + 1}: page`, await activePage());
}

await browser.close();
