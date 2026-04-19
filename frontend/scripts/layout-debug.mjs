import { chromium } from "playwright";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto("http://localhost:3009/papers/pap_planted5", { waitUntil: "networkidle" });
await new Promise((r) => setTimeout(r, 6000));

await page.screenshot({ path: "/tmp/layout-debug-state.png" });

const chain = await page.evaluate(() => {
  const scroller = document.querySelector('[data-page]')?.closest('[class*="overflow-y-auto"]');
  if (!scroller) return { error: "no scroller via data-page", bodyChildren: document.body.innerHTML.length };
  const r = scroller.getBoundingClientRect();
  const cs = getComputedStyle(scroller);
  const results = [{
    tag: scroller.tagName,
    cls: scroller.className.toString().slice(0, 120),
    height: Math.round(r.height),
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    scrollTop: scroller.scrollTop,
    overflow: cs.overflow,
  }];
  let el = scroller.parentElement;
  while (el && el !== document.body) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    results.push({
      tag: el.tagName,
      cls: el.className.toString().slice(0, 120),
      height: Math.round(r.height),
      overflow: cs.overflow,
      display: cs.display,
      minHeight: cs.minHeight,
    });
    el = el.parentElement;
  }
  return results;
});
console.log(JSON.stringify(chain, null, 2));
await browser.close();
