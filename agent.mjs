#!/usr/bin/env node
// agent.mjs — an autonomous buyer agent with its own Arc-testnet wallet.
//
// It discovers a Predge data route on the arc-gateway, receives a 402 quote,
// pays USDC NATIVELY on Circle Arc through PredgeSettlement.payForRoute
// (memo = the quote's request_id), and redeems the on-chain Paid receipt for
// the data. No API keys, no account, no card — the wallet IS the identity.
//
//   node agent.mjs [--route /v1/whales/latest] [--gateway http://localhost:8402] [--watch]
//
//   --watch  redeem WITHOUT presenting the tx hash: the gateway finds the
//            agent's Paid event on-chain by request_id memo itself.
import { Contract, Wallet } from "ethers";
import { loadEnv } from "./lib/env.mjs";
import {
  DEFAULT_RPC,
  SETTLEMENT_ABI,
  fmtUsdc,
  makeProvider,
  txLink,
  withRetry,
} from "./lib/arc.mjs";

const env = loadEnv();

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const GATEWAY = (arg("--gateway", env.GATEWAY_URL || "http://localhost:8402")).replace(/\/$/, "");
const ROUTE = arg("--route", "/v1/whales/latest");
const WATCH = process.argv.includes("--watch");

const PK = env.AGENT_PRIVATE_KEY || env.PRIVATE_KEY;
if (!PK) {
  console.error("No AGENT_PRIVATE_KEY (or PRIVATE_KEY) in .env — run: npm run setup-agent");
  process.exit(1);
}
if (!env.AGENT_PRIVATE_KEY) {
  console.error("(note) using PRIVATE_KEY as the agent wallet; run `npm run setup-agent` for a dedicated one.\n");
}

const provider = makeProvider(env.ARC_RPC || DEFAULT_RPC);
const wallet = new Wallet(PK, provider);

const step = (n, msg) => console.log(`\n[${n}/6] ${msg}`);

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
}

// ---------------------------------------------------------------- 1. discover
step(1, `discover: GET ${GATEWAY}${ROUTE}`);
const first = await getJson(`${GATEWAY}${ROUTE}`);
if (first.status !== 402 || !first.body?.request_id) {
  console.error(`expected 402 quote, got ${first.status}:`, JSON.stringify(first.body)?.slice(0, 300));
  process.exit(1);
}
const quote = first.body;
console.log(`  402 Payment Required — that's the point, not an error.`);
console.log(`  price      ${quote.price_usd}  (${quote.amount_usdc} USDC native on Arc)`);
console.log(`  contract   ${quote.contract}  (chainId ${quote.chain_id})`);
console.log(`  route_hash ${quote.route_hash}`);
console.log(`  request_id ${quote.request_id}`);

// ------------------------------------------------------------------ 2. wallet
step(2, "agent wallet on Arc testnet");
const bal = await withRetry("getBalance", () => provider.getBalance(wallet.address));
console.log(`  agent   ${wallet.address}`);
console.log(`  balance ${fmtUsdc(bal)} USDC (native)`);
const need = BigInt(quote.amount_wei);
if (bal < need + 10n ** 15n) {
  console.error(`  insufficient funds: need ~${fmtUsdc(need)} USDC + gas. Fund via faucet.circle.com or npm run setup-agent.`);
  process.exit(1);
}

// --------------------------------------------------------------------- 3. pay
step(3, `pay: PredgeSettlement.payForRoute(route_hash, request_id) value=${fmtUsdc(need)} USDC`);
const settlement = new Contract(quote.contract, SETTLEMENT_ABI, wallet);
const tx = await withRetry("payForRoute", () =>
  settlement.payForRoute(quote.route_hash, quote.request_id, { value: need }),
);
console.log(`  sent ${tx.hash}`);

// ----------------------------------------------------------------- 4. confirm
step(4, "confirm on Arc");
const receipt = await withRetry("tx.wait", () => tx.wait());
console.log(`  mined in block ${receipt.blockNumber} — receipt is the Paid event`);
console.log(`  ${txLink(tx.hash)}`);

// ------------------------------------------------------------------ 5. redeem
if (WATCH) {
  step(5, `redeem (watch mode): GET ${ROUTE}?request_id=… — gateway scans Arc events itself`);
} else {
  step(5, `redeem: GET ${ROUTE} with X-Arc-Payment: <tx>`);
}
const redeemUrl = WATCH
  ? `${GATEWAY}${ROUTE}?request_id=${quote.request_id}`
  : `${GATEWAY}${ROUTE}`;
const redeemHeaders = WATCH ? {} : { "X-Arc-Payment": tx.hash };
let unlocked = null;
for (let i = 0; i < 10; i++) {
  const r = await getJson(redeemUrl, redeemHeaders);
  if (r.status === 200) {
    unlocked = r.body;
    break;
  }
  console.log(`  not unlocked yet (${r.status} ${r.body?.error || ""}) — retrying…`);
  await new Promise((res) => setTimeout(res, 2500));
}
if (!unlocked) {
  console.error("  failed to redeem after payment — check gateway logs");
  process.exit(1);
}
console.log(`  UNLOCKED — paid receipt verified on-chain by the gateway:`);
console.log(`    payer  ${unlocked.paid.payer}`);
console.log(`    amount ${unlocked.paid.amount_usdc} USDC  block ${unlocked.paid.block}`);
console.log(`    ${unlocked.paid.explorer}`);
const d = unlocked.data;
console.log(`  data_source: ${d.data_source}`);
if (d.trades) {
  console.log(`  got ${d.count} whale trades (min $${d.whale_min_usd}, ${d.delay_minutes}m delay):`);
  for (const t of d.trades.slice(0, 3))
    console.log(
      `    ${t.side.padEnd(8)} $${Math.round(t.size_usd).toLocaleString("en-US").padStart(7)}  ` +
        `${t.market_title}  (wallet score ${t.wallet_score}, wr30 ${t.wallet_win_rate_30d})`,
    );
} else if (d.wallets) {
  console.log(`  got leaderboard (${d.ranked_by}):`);
  for (const w of d.wallets)
    console.log(`    #${w.rank} ${w.wallet}  score ${w.score}  conviction ${w.conviction_score}`);
}

// ------------------------------------------------------------- 6. replay test
step(6, "replay protection: try to redeem the SAME payment again");
const replay = await getJson(`${GATEWAY}${ROUTE}`, { "X-Arc-Payment": tx.hash });
if (replay.status === 409) {
  console.log(`  correctly rejected: ${replay.status} ${replay.body?.error} — one payment, one unlock.`);
} else {
  console.log(`  UNEXPECTED: replay returned ${replay.status} (should be 409)`);
}

console.log(`\ndone — the agent bought Predge whale intel with native USDC on Arc.`);
