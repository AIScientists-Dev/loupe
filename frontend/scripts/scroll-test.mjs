import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:3009/papers/pap_planted5", { waitUntil: "domcontentloaded" });
// Wait for MSW reload cycle + React render
await page.waitForSelector("[data-page]", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 1000));

// Find the scrollable PDF container
const info = await page.evaluate(() => {
  // Container = the div with overflow-y-auto inside PdfViewer
  const scroller = document.querySelector(".overflow-y-auto.px-6.py-6");
  if (!scroller) return { error: "scroller not found" };
  const r = scroller.getBoundingClientRect();
  return {
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    canScroll: scroller.scrollHeight > scroller.clientHeight,
    rect: { x: r.x, y: r.y, w: r.width, h: r.height },
  };
});
console.log("before:", JSON.stringify(info, null, 2));

// Simulate user mousewheel in middle of PDF area
await page.mouse.move(info.rect.x + info.rect.w / 2, info.rect.y + info.rect.h / 2);
await page.mouse.wheel(0, 600);
await new Promise((r) => setTimeout(r, 400));

const after = await page.evaluate(() => {
  const scroller = document.querySelector(".overflow-y-auto.px-6.py-6");
  return { scrollTop: scroller?.scrollTop };
});
console.log("after wheel:", JSON.stringify(after, null, 2));

await page.screenshot({ path: "/tmp/scroll-after.png" });
await browser.close();
