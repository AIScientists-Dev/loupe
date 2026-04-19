import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

page.on("pageerror", (err) => console.log("[pageerror]", err.message));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log("[console error]", msg.text().slice(0, 300));
});

await page.goto("http://localhost:3009/papers/1e500286-d410-4d60-8ed3-be2c8b727d66", {
  waitUntil: "domcontentloaded",
});
await new Promise((r) => setTimeout(r, 10000));

const state = await page.evaluate(() => ({
  h1: document.querySelector("h2")?.textContent ?? document.querySelector("h1")?.textContent ?? "",
  dataPageCount: document.querySelectorAll("[data-page]").length,
  pdfCanvases: document.querySelectorAll("canvas").length,
  toolbarPageInfo: document.querySelector(".tabular-nums")?.textContent ?? "",
  bodyText: document.body.innerText.slice(0, 300),
}));
console.log(JSON.stringify(state, null, 2));
await page.screenshot({ path: "/tmp/real-pdf.png" });

await browser.close();
