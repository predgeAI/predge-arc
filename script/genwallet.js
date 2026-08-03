// Generate (or reuse) a throwaway Arc-testnet DEPLOY wallet.
// Testnet only — no real value. Key is saved to .env (gitignored); print the
// ADDRESS so the operator can fund it from faucet.circle.com (Arc Testnet, USDC).
import { Wallet } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const ENV = new URL("../.env", import.meta.url).pathname;

function parseEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = parseEnv(ENV);
let pk = env.PRIVATE_KEY;
let w;
if (pk) {
  w = new Wallet(pk);
  console.log("Reusing existing deploy wallet.");
} else {
  w = Wallet.createRandom();
  const body =
    `ARC_RPC=${env.ARC_RPC || "https://rpc.testnet.arc.io"}\n` +
    `PRIVATE_KEY=${w.privateKey}\n`;
  writeFileSync(ENV, body);
  console.log("Generated a fresh deploy wallet; key saved to .env (gitignored).");
}

console.log("\nDEPLOY ADDRESS (fund this):");
console.log("  " + w.address);
console.log("\nFund it: https://faucet.circle.com  →  Arc Testnet  →  USDC  →  paste the address above.");
console.log("Then run: npm run deploy");
