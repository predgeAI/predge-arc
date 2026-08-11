// Record the LIVE predge.io UI (feed animating) as a short video clip, so the
// ad can show the real product moving — not a static screenshot.
import pw from "/Users/amir/Documents/Playground/iapm-applyreset/node_modules/playwright/index.js";
const { chromium } = pw;

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: "rec-ui", size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
await page.goto("https://predge.io", { waitUntil: "networkidle" });
await page.waitForTimeout(9000); // capture ~9s of the live feed animating
await context.close();
await browser.close();
console.log("live UI captured");
