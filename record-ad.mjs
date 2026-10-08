// Render ad.html to video, frame by frame. The browser draws our exact pixels
// (typography, product screens, brand colour); we seek the page to t = n/FPS,
// screenshot it, and pipe the frames straight into ffmpeg. Deterministic: every
// cut lands on its exact frame, no dropped frames, no real-time drift.
//
//   node record-ad.mjs                 → rec/ad-169.mp4  (1920x1080)
//   node record-ad.mjs sq              → rec/ad-sq.mp4   (1080x1080)
//   node record-ad.mjs vt              → rec/ad-vt.mp4   (1080x1920)
//   node record-ad.mjs 169 grid        → rec/grid-169/NN.png, one still per frame (for review)
//
// Env: PLAYWRIGHT (path to playwright index.js), CHROME (browser executable).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PW = process.env.PLAYWRIGHT || "/Users/amir/Documents/Playground/iapm-applyreset/node_modules/playwright/index.js";
const CHROME = process.env.CHROME ||
  "/Users/amir/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const { chromium } = (await import(pathToFileURL(PW).href)).default;

const AR = process.argv[2] || "169";
const MODE = process.argv[3] || "video";
const SIZE = { "169": [1920, 1080], sq: [1080, 1080], vt: [1080, 1920] }[AR];
if (!SIZE) throw new Error("aspect must be 169 | sq | vt");
const FPS = 30;
const OUT_DIR = join(HERE, "rec");
mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: SIZE[0], height: SIZE[1] }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(join(HERE, "ad.html")).href + "?ar=" + AR, { waitUntil: "load" });
await page.evaluate(() => document.body.classList.add("recording"));
await page.evaluate(() => document.fonts.ready);
const ad = await page.evaluate(() => window.__ad);

if (MODE === "grid") {
  // One still per cut, taken 85% into the frame (after entrances and count-ups settle).
  const dir = join(OUT_DIR, "grid-" + AR);
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < ad.n; i++) {
    const t = ad.starts[i] + ad.beats[i] * ad.BEAT * 0.85;
    await page.evaluate((t) => window.__seek(t), t);
    await page.screenshot({ path: join(dir, String(i + 1).padStart(2, "0") + ".png") });
  }
  console.log("grid:", dir, ad.n, "frames");
} else {
  const total = Math.ceil(ad.TOTAL * FPS);
  const out = join(OUT_DIR, `ad-${AR}.mp4`);
  const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p", "-threads", "3", "-r", String(FPS), "-movflags", "+faststart", out],
    { stdio: ["pipe", "inherit", "inherit"] });
  for (let n = 0; n < total; n++) {
    await page.evaluate((t) => window.__seek(t), n / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (n % 300 === 0) console.log(`${AR}: ${n}/${total}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
  console.log("video:", out, (total / FPS).toFixed(2) + "s");
}
await browser.close();
