import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("console", (msg) => {
  const t = msg.text();
  if (t.includes("MSW") || t.includes("[loupe") || t.includes("Mock"))
    console.log(`LOG: ${t}`);
});
page.on("response", (r) => {
  if (r.url().includes("/api/v1/papers")) {
    console.log(`RESP: ${r.url()} → ${r.status()} (sw=${r.fromServiceWorker()})`);
  }
});
await page.goto("http://localhost:3009/papers", { waitUntil: "networkidle" });
await new Promise((r) => setTimeout(r, 4000));
await browser.close();
