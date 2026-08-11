// Render thumb.html to a crisp 1280x720 PNG YouTube thumbnail (2x for sharpness).
import pw from "/Users/amir/Documents/Playground/iapm-applyreset/node_modules/playwright/index.js";
const { chromium } = pw;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 720 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();
await page.goto("file:///Users/amir/Documents/Playground/predge-arc/thumb.html", { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.screenshot({ path: "/Users/amir/Documents/Playground/predge-arc/predge-thumb.png", clip: { x: 0, y: 0, width: 1280, height: 720 } });
await browser.close();
console.log("thumbnail saved");
