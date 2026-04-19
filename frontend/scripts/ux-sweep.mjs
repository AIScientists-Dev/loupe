import { chromium } from "playwright";

const PAPER = "http://localhost:3009/papers/1e500286-d410-4d60-8ed3-be2c8b727d66";
const bugs = [];
const addBug = (severity, where, what) => {
  bugs.push({ severity, where, what });
  console.log(`[${severity}] ${where}: ${what}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const errors = [];
page.on("pageerror", (err) => {
  errors.push(err.message);
  addBug("HIGH", "pageerror", err.message.slice(0, 140));
});
page.on("console", (m) => {
  if (m.type() === "error") {
    const t = m.text();
    if (t.includes("KaTeX") || t.includes("ParseError")) {
      addBug("MED", "console", t.slice(0, 140));
    } else if (!t.includes("React DevTools")) {
      errors.push(t);
    }
  }
});
page.on("response", (r) => {
  if (r.status() >= 400) addBug("HIGH", "network", `${r.status()} ${r.url()}`);
});

await page.goto(PAPER, { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-page]", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 5000));

// === NORMAL USER PASS ===
console.log("\n=== NORMAL USER PASS ===");

// 1. Look at first card, read it, click Agree.
let openCards = await page.$$("article");
console.log(`Open cards visible: ${openCards.length}`);
if (openCards.length < 2) addBug("LOW", "open-tab", `only ${openCards.length} open cards — prior tests ate them`);

// First card: click Agree
if (openCards.length > 0) {
  await openCards[0].click();
  await new Promise((r) => setTimeout(r, 400));
  const agreeBtns = await page.locator('article >> button:has-text("Agree")').all();
  if (agreeBtns.length === 0) addBug("HIGH", "agree-flow", "first card has no Agree button");
  else {
    await agreeBtns[0].click();
    await new Promise((r) => setTimeout(r, 500));
    const ta = await page.locator("textarea").count();
    if (ta === 0) addBug("HIGH", "agree-flow", "Agree click did not open note textarea");
    const confirm = await page.locator('button:has-text("Confirm agree")').count();
    if (confirm === 0) addBug("HIGH", "agree-flow", "Confirm agree button missing after Agree");
    // Type a note and confirm.
    if (ta > 0) {
      await page.locator("textarea").first().fill("Looks correct");
      await page.locator('button:has-text("Confirm agree")').first().click();
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}
await page.screenshot({ path: "/tmp/sweep-after-agree.png" });

// 2. Confirm the decided bbox shows Processed chip.
const chips = await page.evaluate(() =>
  Array.from(document.querySelectorAll("span"))
    .map((s) => s.textContent?.trim() || "")
    .filter((t) => t.startsWith("Processed"))
);
console.log(`Processed chips on PDF: ${chips.length}`);
if (chips.length === 0) addBug("HIGH", "bbox-state", "no Processed chip after Agree");

// 3. Dismiss the next open card.
openCards = await page.$$("article");
if (openCards.length > 0) {
  await openCards[0].click();
  await new Promise((r) => setTimeout(r, 300));
  const dismissBtns = await page.locator('article >> button:has-text("Dismiss")').all();
  if (dismissBtns.length) {
    await dismissBtns[0].click();
    await new Promise((r) => setTimeout(r, 400));
    await page.locator('button:has-text("Confirm dismiss")').first().click().catch(() => {
      addBug("HIGH", "dismiss-flow", "Confirm dismiss click failed");
    });
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// 4. Switch to Dismissed tab, pick a card, click Reopen chip on PDF.
await page.locator('button[role="tab"]:has-text("Dismissed")').click();
await new Promise((r) => setTimeout(r, 500));
const dismissedCards = await page.$$("article");
if (dismissedCards.length > 0) {
  await dismissedCards[0].click();
  await new Promise((r) => setTimeout(r, 1500));
  const reopen = await page.locator('button:has-text("Reopen")').count();
  if (reopen === 0) addBug("MED", "reopen-chip", "no Reopen button visible after navigating to dismissed");
  else {
    await page.locator('button:has-text("Reopen")').first().click();
    await new Promise((r) => setTimeout(r, 1000));
    const textareas = await page.locator("textarea").count();
    const confirmButtons = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .map((b) => b.textContent?.trim() || "")
        .filter((t) => t.startsWith("Confirm"))
    );
    if (textareas === 0) addBug("HIGH", "reopen", "Reopen did not open editing textarea");
    if (!confirmButtons.some((t) => t.includes("dismiss"))) {
      addBug("MED", "reopen-mode", `expected Confirm dismiss, got ${JSON.stringify(confirmButtons)}`);
    }
  }
}
await page.screenshot({ path: "/tmp/sweep-reopen.png" });

// === PICKY USER PASS ===
console.log("\n=== PICKY USER PASS ===");

// Back to Open tab for further probing.
await page.locator('button[role="tab"]:has-text("Open")').click();
await new Promise((r) => setTimeout(r, 400));

// P1. Double-click the Agree button — should NOT submit twice.
openCards = await page.$$("article");
if (openCards.length) {
  await openCards[0].click();
  await new Promise((r) => setTimeout(r, 300));
  const agree = page.locator('article >> button:has-text("Agree")').first();
  if (await agree.count()) {
    await agree.dblclick();
    await new Promise((r) => setTimeout(r, 500));
    const textareas = await page.locator("textarea").count();
    if (textareas > 1) addBug("MED", "double-click", `double-click opened ${textareas} textareas`);
    // Cancel out.
    const cancelBtns = await page.locator('button:has-text("Cancel")').all();
    if (cancelBtns.length) await cancelBtns[0].click().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
  }
}

// P2. Sort toggle: verify it cycles severity↔page and list reorders.
const sortBtn = page.locator('button:has-text("Severity"), button:has-text("Page")').first();
const before = await sortBtn.textContent();
await sortBtn.click();
await new Promise((r) => setTimeout(r, 300));
const after = await sortBtn.textContent();
if (before === after) addBug("MED", "sort", "Sort button text did not change on click");

// P3. j/k keyboard navigation.
await page.keyboard.press("Escape");
await page.locator("body").click();
const selectedBefore = await page.evaluate(() =>
  document.querySelector('article[class*="ring-primary"]')?.textContent?.slice(0, 40) || ""
);
await page.keyboard.press("j");
await new Promise((r) => setTimeout(r, 300));
const selectedAfter = await page.evaluate(() =>
  document.querySelector('article[class*="ring-primary"]')?.textContent?.slice(0, 40) || ""
);
if (selectedBefore === selectedAfter && selectedBefore !== "") {
  addBug("LOW", "hotkeys", "j key did not advance selection");
}

// P4. 'a' key should NOT agree anymore (we removed it).
const agreedCount = async () => {
  const tabs = await page.locator('button[role="tab"]').all();
  for (const t of tabs) {
    const txt = (await t.textContent()) || "";
    if (txt.startsWith("Agreed")) return Number(txt.match(/\d+/)?.[0] || 0);
  }
  return 0;
};
const agreedBefore = await agreedCount();
await page.keyboard.press("a");
await new Promise((r) => setTimeout(r, 400));
const agreedAfter = await agreedCount();
if (agreedAfter > agreedBefore) addBug("MED", "hotkeys", `'a' key still triggers agree (${agreedBefore}→${agreedAfter})`);

// P5. Zoom with trackpad pinch.
const beforeZoom = await page.locator(".tabular-nums >> nth=1").textContent().catch(() => "");
await page.mouse.move(720, 450);
await page.mouse.wheel(0, -200, { deltaMode: 0 }).catch(async () => {
  // Fallback: dispatch wheel with ctrl
  await page.evaluate(() => {
    const el = document.querySelector(".min-h-0.flex-1.overflow-y-auto");
    el?.dispatchEvent(new WheelEvent("wheel", { deltaY: -200, ctrlKey: true, bubbles: true, cancelable: true }));
  });
});
await new Promise((r) => setTimeout(r, 500));

// P6. Toggle thumbnails open/closed rapidly.
const thumbBtn = page.locator('button[aria-label*="thumbnails"]').first();
for (let i = 0; i < 4; i++) {
  await thumbBtn.click();
  await new Promise((r) => setTimeout(r, 150));
}
await new Promise((r) => setTimeout(r, 500));
const thumbsOpen = await page.evaluate(() =>
  Boolean(document.querySelector("aside.relative.flex.shrink-0.flex-col"))
);
console.log(`thumbs open after toggle storm: ${thumbsOpen}`);

// P7. Scroll PDF mid-select: does the auto-scroll race?
const scroller = page.locator(".min-h-0.flex-1.overflow-y-auto.bg-neutral-100").first();
await scroller.evaluate((el) => (el.scrollTop = 0));
await openCards[0]?.click().catch(() => {});
await new Promise((r) => setTimeout(r, 200));
await scroller.evaluate((el) => el.scrollBy({ top: 2000 }));
await new Promise((r) => setTimeout(r, 1200));
const st = await scroller.evaluate((el) => el.scrollTop);
console.log(`scrollTop after racing: ${st}`);

// P8. Viewport resize: does the finding panel stay usable at 1024px?
await page.setViewportSize({ width: 1024, height: 800 });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: "/tmp/sweep-1024.png" });
const overflow = await page.evaluate(() => {
  const p = document.querySelector("aside.relative") || document.body;
  return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
});
if (overflow.scrollW > overflow.clientW + 4) {
  addBug("MED", "viewport-1024", `horizontal overflow: ${overflow.scrollW}>${overflow.clientW}`);
}

// P9. Very narrow viewport: still no crash?
await page.setViewportSize({ width: 900, height: 700 });
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: "/tmp/sweep-900.png" });

// P10. Back to normal and verify math rendering did not crash any card.
await page.setViewportSize({ width: 1440, height: 900 });
await new Promise((r) => setTimeout(r, 400));
const katexErrors = await page.evaluate(() =>
  Array.from(document.querySelectorAll(".katex-error")).map((e) => e.textContent?.slice(0, 80))
);
if (katexErrors.length) addBug("MED", "katex", `${katexErrors.length} render errors: ${katexErrors[0]}`);

// Final report.
await page.screenshot({ path: "/tmp/sweep-final.png" });
console.log("\n=== SUMMARY ===");
console.log(`Total issues: ${bugs.length}`);
console.log(`Page errors (JS): ${errors.length}`);

await browser.close();

console.log("\n=== BUG LIST ===");
for (const b of bugs) console.log(`  [${b.severity}] ${b.where}: ${b.what}`);
