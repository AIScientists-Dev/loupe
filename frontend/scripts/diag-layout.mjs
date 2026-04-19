import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:3009/papers/pap_planted5", { waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 4000));
// Click the cost chip to open drawer
const costChip = await page.$("button[aria-label='Open cost breakdown']");
if (costChip) await costChip.click();
await new Promise((r) => setTimeout(r, 500));
// Measure cost drawer width
const info = await page.evaluate(() => {
  const drawer = document.querySelector("#cost-drawer-body");
  const costBar = document.querySelector("aside");
  const main = document.querySelector("main");
  const rects = {
    drawer: drawer?.getBoundingClientRect(),
    sidebar: costBar?.getBoundingClientRect(),
    main: main?.getBoundingClientRect(),
    sidebarInner: document.querySelector("aside > div")?.getBoundingClientRect(),
  };
  return rects;
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: "/tmp/layout-check.png" });
await browser.close();
