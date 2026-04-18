import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("console", (msg) => {
  const text = msg.text();
  if (text.includes("loupe") || text.includes("MSW") || text.includes("Mock"))
    console.log(`console.${msg.type()}: ${text}`);
});
page.on("pageerror", (e) => console.log(`pageerror: ${e.message}`));
page.on("response", (r) => {
  if (r.status() >= 400) console.log(`HTTP ${r.status()} ${r.url()}`);
});
await page.goto("http://localhost:3009/papers/pap_planted5", { waitUntil: "networkidle" });
await new Promise((r) => setTimeout(r, 4000));
const text = (await page.evaluate(() => document.body.innerText)).slice(0, 400);
console.log("--- body.innerText ---");
console.log(text);
await browser.close();
