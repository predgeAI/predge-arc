// Render ad.html to a real video file by playing it in a headless Chromium and
// recording the page. No screen-capture, no Higgsfield — the browser draws our
// exact pixels (typography, live screens, brand colour) and Playwright films it.
// Output webm is transcoded to H.264 mp4 by ffmpeg afterwards.
import pw from "/Users/amir/Documents/Playground/iapm-applyreset/node_modules/playwright/index.js";
const { chromium } = pw;

const AD = "file:///Users/amir/Documents/Playground/predge-arc/ad.html";
const OUT_DIR = "/Users/amir/Documents/Playground/predge-arc/rec";
const DURATION_MS = 54000; // ad is ~52.5s; a little tail for the logo hold

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT_DIR, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();
await page.goto(AD, { waitUntil: "load" });

// Hide the operator HUD (the bottom bar) so it never appears in the film.
await page.evaluate(() => document.body.classList.add("recording"));
await page.waitForTimeout(400);

// Start playback from t0 (the 'r' key = instant restart, no count-in).
await page.focus("body").catch(() => {});
await page.keyboard.press("r");

await page.waitForTimeout(DURATION_MS);

await context.close(); // finalizes and flushes the webm
await browser.close();
console.log("done");
