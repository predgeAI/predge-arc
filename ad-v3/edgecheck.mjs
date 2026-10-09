// Usage: node build.mjs <ar> && node edgecheck.mjs $PWD/index.html <width> <height>  (prints "clean" or each offending frame)
// Seek the composition frame by frame and report any visible text that crosses the frame edge.
// Text inside a clip-path crop window is skipped: the window itself is computed inside the frame.
import { pathToFileURL } from "node:url";
const PW = process.env.PLAYWRIGHT || "/Users/amir/Documents/Playground/iapm-applyreset/node_modules/playwright/index.js";
const CHROME = process.env.CHROME || "/Users/amir/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";
const { chromium } = (await import(pathToFileURL(PW).href)).default;
const [file, W, H] = [process.argv[2], +process.argv[3], +process.argv[4]];
const b = await chromium.launch({ executablePath: CHROME });
const p = await b.newPage({ viewport: { width: W, height: H } });
await p.addInitScript(() => { window.__timelines = {}; });
p.on("pageerror", (e) => console.log("PAGEERR", e.message)); p.on("console", (m) => m.type() === "error" && console.log("CONSOLE", m.text()));
await p.goto(pathToFileURL(file).href);
await p.waitForFunction(() => !!window.__timelines.main, null, { timeout: 8000, polling: 200 });
const res = await p.evaluate(({ W, H }) => {
  const tl = window.__timelines.main, clips = [...document.querySelectorAll("[data-start]")].filter((c) => c.id !== "root");
  const total = +document.getElementById("root").dataset.duration, out = [];
  const leaves = [...document.querySelectorAll("#root *")].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  for (let f = 0; f < total * 30; f++) {
    const t = f / 30; tl.seek(t, false);
    for (const c of clips) { const s = +c.dataset.start, d = +c.dataset.duration; c.style.visibility = t >= s && t < s + d ? "visible" : "hidden"; }
    for (const e of leaves) {
      let o = 1, n = e, vis = true;
      let clipped = false;
      while (n && n.nodeType === 1) { const cs = getComputedStyle(n); o *= +cs.opacity; if (cs.visibility === "hidden" || cs.display === "none") vis = false; if (cs.clipPath && cs.clipPath !== "none") clipped = true; n = n.parentElement; }
      // inside a crop window (clip-path inset, always inside the frame) only the window can show
      if (clipped) continue;
      if (!vis || o < 0.04) continue;
      const r = e.getBoundingClientRect(); if (!r.width) continue;
      if (r.left < -1 || r.top < -1 || r.right > W + 1 || r.bottom > H + 1) out.push(`${t.toFixed(2)} op=${o.toFixed(2)} "${e.textContent.trim().slice(0, 30)}" [${r.left|0},${r.top|0},${r.right|0},${r.bottom|0}]`);
    }
  }
  return out;
}, { W, H });
console.log(res.length ? res.join("\n") : "clean");
await b.close();
