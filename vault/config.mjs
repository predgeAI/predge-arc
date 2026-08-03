// Vault-keeper configuration. Everything comes from the environment (.env is
// loaded by lib/env.mjs). No secret ever has a default and no secret is logged.
import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "../lib/env.mjs";
import { DEFAULT_RPC } from "../lib/arc.mjs";

const env = loadEnv();

const DEPLOYMENT_FILE = new URL("./deployment.json", import.meta.url).pathname;

function readDeployment() {
  if (!existsSync(DEPLOYMENT_FILE)) return {};
  try {
    return JSON.parse(readFileSync(DEPLOYMENT_FILE, "utf8"));
  } catch {
    return {};
  }
}

function num(name, def) {
  const raw = env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive number, got "${raw}"`);
  return n;
}

const deployment = readDeployment();
const PREDGE = (env.PREDGE_BASE_URL || "https://x402-api-production-266e.up.railway.app").replace(/\/+$/, "");

export const config = {
  // --- Arc (on-chain leg) --------------------------------------------------
  arcRpc: env.ARC_RPC || DEFAULT_RPC,
  // The keeper wallet that calls rebalance() — the operator by default. Never
  // logged; kept only to sign Arc txs.
  keeperKey: env.VAULT_KEEPER_KEY || env.PRIVATE_KEY,
  // Depositor wallet for the demo deposit (agent by default, else operator).
  depositorKey: env.AGENT_PRIVATE_KEY || env.PRIVATE_KEY,
  vaultAddress: env.VAULT_ADDRESS || deployment.address || null,

  // --- Predge signed consensus (the signal) --------------------------------
  predgeBaseUrl: PREDGE,
  registryUrl: `${PREDGE}/.well-known/predge-keys.json`,
  consensusRoute: env.CONSENSUS_ROUTE || "/v1/signals/consensus",
  buyerKey: env.BUYER_PRIVATE_KEY, // Base-mainnet USDC wallet for LIVE x402 pay
  x402Network: env.X402_NETWORK || "base",
  maxPriceUsd: num("MAX_PRICE_USD", 0.05),
  userAgent: "predge-signal-vault/1.0.0",

  // --- Decision rule (transparent thresholds) ------------------------------
  flowMinUsd: num("FLOW_MIN_USD", 5000),
  minSmartWallets: Math.floor(num("MIN_SMART_WALLETS", 3)),
  watchMarket: env.WATCH_MARKET || "top",
};

export { deployment as DEPLOYMENT };
