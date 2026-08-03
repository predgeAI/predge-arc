// What the arc-gateway sells, at what price, and where the payload comes from.
//
// HONESTY NOTE: on production, Predge whale data is live from the tracking
// pipeline and sold over x402 on Base + Solana (all data routes are paid, so
// there is no free live feed this demo could proxy without embedding paid
// credentials — which we deliberately do NOT do). This Arc demo therefore
// serves SAMPLE payloads frozen in the exact production response shape,
// clearly labeled via `data_source: "sample"`. The paywall, quotes, on-chain
// settlement and receipt verification are all real and live on Arc testnet.
import { readFileSync } from "node:fs";

const PREDGE_UPSTREAM = "https://x402-api-production-266e.up.railway.app";

const sample = (name) =>
  JSON.parse(readFileSync(new URL(`./sample/${name}`, import.meta.url), "utf8"));

// Prices mirror the production x402 price card (USD == USDC). Arc's native
// USDC uses 18 decimals at the RPC level: $0.005 => 5e15 wei.
export const CATALOG = {
  "/v1/whales/latest": {
    route: "arc/v1/whales/latest", // string hashed into the on-chain bytes32 route id
    priceUsd: "$0.005",
    amountWei: 5_000_000_000_000_000n, // 0.005 native USDC
    description: "Latest Polymarket whale trades (production shape; sample payload on Arc demo).",
    payload: () => ({
      data_source: "sample",
      data_note:
        `Frozen sample in the exact production response shape of GET /v1/whales/latest. ` +
        `Live data is sold per-call at ${PREDGE_UPSTREAM} (x402, Base + Solana).`,
      ...sample("whales-latest.json"),
    }),
  },
  "/v1/wallets/leaderboard": {
    route: "arc/v1/wallets/leaderboard",
    priceUsd: "$0.01",
    amountWei: 10_000_000_000_000_000n, // 0.01 native USDC
    description: "Top Polymarket wallets ranked by EDGE (production shape; sample payload).",
    payload: () => ({
      data_source: "sample",
      data_note:
        `Frozen sample in the production response shape of GET /v1/wallets/leaderboard. ` +
        `Live data is sold per-call at ${PREDGE_UPSTREAM} (x402, Base + Solana).`,
      ...sample("wallets-leaderboard.json"),
    }),
  },
};

export { PREDGE_UPSTREAM };
