// Tiny .env loader (no dependency). Reads KEY=VALUE lines; process.env wins.
import { readFileSync, existsSync } from "node:fs";

export function loadEnv(path = new URL("../.env", import.meta.url).pathname) {
  const out = {};
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (m) out[m[1]] = m[2];
    }
  }
  // Real environment variables override the file.
  for (const [k, v] of Object.entries(process.env)) {
    if (/^[A-Z0-9_]+$/.test(k)) out[k] = v;
  }
  return out;
}
