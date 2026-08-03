#!/usr/bin/env node
// anchor.mjs — anchor Predge's tamper-evident hash chain onto Circle Arc.
//
// Predge's paid calls are ed25519-signed and hash-chained server-side (verify
// any call free at /verify?id=…, keys at /.well-known/predge-keys.json). A
// hash chain alone proves ORDER, but a malicious server could still rewrite
// history wholesale. Anchoring the chain head on Arc makes that impossible:
// once the head hash sits in an on-chain Paid receipt, every earlier record
// is frozen by an L1 the operator doesn't control.
//
//   node anchor.mjs --hash <64-hex sha256>     anchor a chain-head content hash
//   node anchor.mjs --keys                     fetch + anchor the live key registry
//                                              (sha256 of /.well-known/predge-keys.json bytes)
//   node anchor.mjs --verify <64-hex sha256>   find an existing anchor on Arc
//
// Options: --value <wei> (default 1000000000000 = 0.000001 USDC)
//          --from-block <n> (verify scan start; default latest-200000)
import { Contract, Wallet } from "ethers";
import { createHash } from "node:crypto";
import { loadEnv } from "./lib/env.mjs";
import {
  DEFAULT_CONTRACT,
  DEFAULT_RPC,
  SETTLEMENT_ABI,
  fmtUsdc,
  makeProvider,
  routeHash,
  txLink,
  withRetry,
} from "./lib/arc.mjs";

const ANCHOR_ROUTE = "predge/anchor"; // bytes32 route id = keccak256 of this
const KEYS_URL = "https://x402-api-production-266e.up.railway.app/.well-known/predge-keys.json";

const env = loadEnv();
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i > -1 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : undefined;
};

const provider = makeProvider(env.ARC_RPC || DEFAULT_RPC);
const CONTRACT = env.ARC_CONTRACT || DEFAULT_CONTRACT;
const anchorRouteHash = routeHash(ANCHOR_ROUTE);

const normalizeHash = (raw) => {
  const h = String(raw).toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{64}$/.test(h)) {
    console.error(`--hash must be a 32-byte hex digest (64 hex chars), got: ${raw}`);
    process.exit(1);
  }
  return h;
};

// ------------------------------------------------------------------- verify --
if (flag("--verify")) {
  const target = normalizeHash(flag("--verify"));
  const contract = new Contract(CONTRACT, SETTLEMENT_ABI, provider);
  const latest = await withRetry("blockNumber", () => provider.getBlockNumber());
  const from = Number(flag("--from-block") ?? Math.max(0, latest - 200_000));
  console.log(`Scanning Arc for anchor of sha256:${target}`);
  console.log(`  route ${ANCHOR_ROUTE} (${anchorRouteHash}), blocks ${from}…${latest}`);
  const CHUNK = 5_000;
  const filter = contract.filters.Paid(null, anchorRouteHash);
  for (let start = from; start <= latest; start += CHUNK + 1) {
    const end = Math.min(start + CHUNK, latest);
    const events = await withRetry(`getLogs ${start}-${end}`, () =>
      contract.queryFilter(filter, start, end),
    );
    for (const ev of events) {
      if (String(ev.args?.meta || "").includes(target)) {
        console.log(`\nANCHORED — found on Arc:`);
        console.log(`  meta   ${ev.args.meta}`);
        console.log(`  payer  ${ev.args.payer}`);
        console.log(`  block  ${ev.blockNumber}  at unix ${ev.args.timestamp}`);
        console.log(`  tx     ${txLink(ev.transactionHash)}`);
        process.exit(0);
      }
    }
  }
  console.log("\nNot found in the scanned range (try --from-block with an earlier block).");
  process.exit(2);
}

// -------------------------------------------------------------------- anchor --
let hashHex;
let kind;
if (flag("--keys")) {
  console.log(`Fetching live key registry: ${KEYS_URL}`);
  const res = await fetch(KEYS_URL);
  if (!res.ok) {
    console.error(`Fetch failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  hashHex = createHash("sha256").update(bytes).digest("hex");
  kind = "keys";
  console.log(`  sha256(${bytes.length} bytes) = ${hashHex}`);
  console.log(`  (reproduce: curl -s ${KEYS_URL} | shasum -a 256)`);
} else if (flag("--hash")) {
  hashHex = normalizeHash(flag("--hash"));
  kind = "chain-head";
} else {
  console.error(
    "Usage:\n  node anchor.mjs --hash <64-hex sha256>   anchor a signed-calls chain head\n" +
      "  node anchor.mjs --keys                   anchor the live predge-keys.json registry\n" +
      "  node anchor.mjs --verify <64-hex sha256> check whether a hash is anchored on Arc",
  );
  process.exit(1);
}

const PK = env.PRIVATE_KEY || env.AGENT_PRIVATE_KEY;
if (!PK) {
  console.error("No PRIVATE_KEY in .env (anchoring is an operator action). Run `npm run genwallet` + fund it.");
  process.exit(1);
}
const wallet = new Wallet(PK, provider);
const value = BigInt(flag("--value") || env.ANCHOR_VALUE || "1000000000000"); // 0.000001 USDC
const meta = `anchor:${kind}:sha256:${hashHex}`;

console.log(`\nAnchoring on Arc testnet as a PredgeSettlement Paid receipt:`);
console.log(`  contract ${CONTRACT}`);
console.log(`  route    ${ANCHOR_ROUTE} (${anchorRouteHash})`);
console.log(`  meta     ${meta}`);
console.log(`  value    ${fmtUsdc(value)} USDC (dust — the receipt is the point)`);
console.log(`  signer   ${wallet.address}`);

const settlement = new Contract(CONTRACT, SETTLEMENT_ABI, wallet);
const tx = await withRetry("payForRoute", () => settlement.payForRoute(anchorRouteHash, meta, { value }));
console.log(`\n  sent ${tx.hash}`);
const receipt = await withRetry("tx.wait", () => tx.wait());
console.log(`  mined in block ${receipt.blockNumber}`);
console.log(`\nANCHORED. The chain head is now frozen by Arc:`);
console.log(`  ${txLink(tx.hash)}`);
console.log(`\nVerify later:  node anchor.mjs --verify ${hashHex} --from-block ${receipt.blockNumber - 10}`);
