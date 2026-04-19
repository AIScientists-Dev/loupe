import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (err) => console.log("[err]", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console]", msg.text().slice(0, 200));
});
await page.goto("http://localhost:3009/papers/1e500286-d410-4d60-8ed3-be2c8b727d66", {
  waitUntil: "domcontentloaded",
});
await page.waitForSelector("[data-page]", { timeout: 20000 });
await new Promise((r) => setTimeout(r, 3500));
await page.screenshot({ path: "/tmp/pdf-p1.png" });

// Open thumbs
const toggle = await page.$("button[aria-label*='thumbnails']");
if (toggle) await toggle.click();
await new Promise((r) => setTimeout(r, 1500));
await page.screenshot({ path: "/tmp/pdf-thumbs.png" });

// Scroll to a page with a finding (page 29)
const link = await page.evaluate(() => {
  const findingSelector = document.querySelectorAll("[class*='border-severity']");
  return findingSelector.length;
});
console.log("finding bboxes rendered:", link);

await browser.close();
