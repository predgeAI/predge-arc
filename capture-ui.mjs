// Capture the REAL predge.io UI (hero + live whale feed) as a clean 1080p PNG,
// so the ad can flash actual product surfaces, not just mockups.
import pw from "/Users/amir/Documents/Playground/iapm-applyreset/node_modules/playwright/index.js";
const { chromium } = pw;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto("https://predge.io", { waitUntil: "networkidle" });
await page.waitForTimeout(2500); // let the live feed populate
await page.screenshot({ path: "ad-assets/real-hero.png" });

// Try to grab just the live-feed card tight, if present.
const feed = page.locator("text=WHALE ACTIVITY").first();
try {
  const card = feed.locator("xpath=ancestor::*[self::div][3]");
  await card.screenshot({ path: "ad-assets/real-feed.png" });
} catch (e) { console.log("feed crop skipped:", e.message.split("\n")[0]); }

await browser.close();
console.log("captured");
