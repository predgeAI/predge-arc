// arc-gateway — Predge's Arc-native pay-per-call gateway.
//
// The x402 idea ("HTTP 402 + pay USDC + retry") re-based onto Circle Arc,
// where USDC is the NATIVE token and settlement happens through the deployed
// PredgeSettlement contract:
//
//   1. GET a data route             -> 402 + quote {contract, routeHash, amount, requestId}
//   2. agent pays on Arc            -> PredgeSettlement.payForRoute(routeHash, requestId) {value: amount}
//   3. retry with X-Arc-Payment: tx -> gateway verifies the Paid receipt on-chain -> 200 + data
//      …or retry with ?request_id=  -> gateway itself scans Paid events for the memo
//
// SECURITY PROPERTY: this service holds NO private key. It only *reads* Arc
// (receipts + events). Funds accumulate in the contract; the owner withdraws
// with the contract's own withdraw() — the gateway can't touch money at all.
import express from "express";
import { randomUUID } from "node:crypto";
import { Interface } from "ethers";
import { loadEnv } from "../lib/env.mjs";
import {
  ARC_CHAIN_ID,
  DEFAULT_CONTRACT,
  DEFAULT_RPC,
  SETTLEMENT_ABI,
  addressLink,
  fmtUsdc,
  makeProvider,
  routeHash,
  settlementContract,
  txLink,
  withRetry,
} from "../lib/arc.mjs";
import { CATALOG, PREDGE_UPSTREAM } from "./catalog.mjs";

const env = loadEnv();
const PORT = Number(env.GATEWAY_PORT || 8402);
const RPC = env.ARC_RPC || DEFAULT_RPC;
const CONTRACT = (env.ARC_CONTRACT || DEFAULT_CONTRACT);
const QUOTE_TTL_MS = Number(env.QUOTE_TTL_MS || 15 * 60 * 1000); // advisory
const QUOTE_EVICT_MS = 60 * 60 * 1000;
const EVENT_SCAN_MAX_BLOCKS = Number(env.EVENT_SCAN_MAX_BLOCKS || 50_000);
const EVENT_SCAN_CHUNK = Number(env.EVENT_SCAN_CHUNK || 5_000);

const provider = makeProvider(RPC);
const contract = settlementContract(provider, CONTRACT);
const iface = new Interface(SETTLEMENT_ABI);

/** requestId -> quote {path, route, routeHash, amountWei, createdAt, createdBlock, expiresAt, redeemed} */
const quotes = new Map();
/** replay guard: tx hash -> requestId it redeemed */
const usedTxs = new Map();

function evictOldQuotes() {
  const now = Date.now();
  for (const [id, q] of quotes) if (now - q.createdAt > QUOTE_EVICT_MS) quotes.delete(id);
}
setInterval(evictOldQuotes, 60_000).unref();

async function makeQuote(path, entry) {
  const requestId = randomUUID();
  const createdBlock = await withRetry("blockNumber", () => provider.getBlockNumber());
  const q = {
    path,
    route: entry.route,
    routeHash: routeHash(entry.route),
    amountWei: entry.amountWei,
    priceUsd: entry.priceUsd,
    createdAt: Date.now(),
    createdBlock,
    expiresAt: new Date(Date.now() + QUOTE_TTL_MS).toISOString(),
    redeemed: false,
    txHash: null,
  };
  quotes.set(requestId, q);
  return { requestId, q };
}

function paymentInstructions(requestId, q) {
  return {
    error: "payment_required",
    scheme: "predge-arc-settlement-v1",
    network: "arc-testnet",
    chain_id: Number(ARC_CHAIN_ID),
    contract: CONTRACT,
    route: q.route,
    route_hash: q.routeHash,
    amount_wei: q.amountWei.toString(), // native USDC, 18 decimals on Arc
    amount_usdc: fmtUsdc(q.amountWei),
    price_usd: q.priceUsd,
    request_id: requestId,
    expires_at: q.expiresAt,
    how_to_pay:
      `On Arc testnet (chainId ${ARC_CHAIN_ID}) call ` +
      `PredgeSettlement(${CONTRACT}).payForRoute(route_hash, request_id) ` +
      `with value = amount_wei (USDC is Arc's native token — msg.value IS the USDC payment).`,
    how_to_redeem:
      `Retry this route with header "X-Arc-Payment: <txHash>" — or just retry with ` +
      `?request_id=${requestId} and the gateway will find your Paid event on-chain itself.`,
    explorer_contract: addressLink(CONTRACT),
  };
}

/** Parse a mined tx receipt into the Paid event it emitted from OUR contract. */
async function verifyByTxHash(txHash) {
  const receipt = await withRetry("getTransactionReceipt", () =>
    provider.getTransactionReceipt(txHash),
  );
  if (!receipt) return { ok: false, code: "tx_not_found", detail: "No mined receipt for that hash yet." };
  if (receipt.status !== 1) return { ok: false, code: "tx_reverted" };
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== CONTRACT.toLowerCase()) continue;
    let parsed;
    try {
      parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }
    if (parsed?.name !== "Paid") continue;
    return {
      ok: true,
      receipt,
      payer: parsed.args.payer,
      route: parsed.args.route,
      amount: parsed.args.amount,
      timestamp: parsed.args.timestamp,
      meta: parsed.args.meta,
    };
  }
  return { ok: false, code: "no_paid_event", detail: "Tx did not emit a Paid event from the settlement contract." };
}

/** Gateway-side watcher: scan Paid events since the quote was created for our requestId memo. */
async function scanForPayment(requestId, q) {
  const latest = await withRetry("blockNumber", () => provider.getBlockNumber());
  let from = q.createdBlock;
  if (latest - from > EVENT_SCAN_MAX_BLOCKS) from = latest - EVENT_SCAN_MAX_BLOCKS;
  const filter = contract.filters.Paid(null, q.routeHash);
  for (let start = from; start <= latest; start += EVENT_SCAN_CHUNK + 1) {
    const end = Math.min(start + EVENT_SCAN_CHUNK, latest);
    const events = await withRetry(`getLogs ${start}-${end}`, () =>
      contract.queryFilter(filter, start, end),
    );
    for (const ev of events) {
      if (ev.args?.meta === requestId) {
        return {
          ok: true,
          txHash: ev.transactionHash,
          payer: ev.args.payer,
          route: ev.args.route,
          amount: ev.args.amount,
          timestamp: ev.args.timestamp,
          meta: ev.args.meta,
          blockNumber: ev.blockNumber,
        };
      }
    }
  }
  return { ok: false };
}

function paidBlock(payment, txHash, blockNumber) {
  return {
    tx_hash: txHash,
    payer: payment.payer,
    route_hash: payment.route,
    amount_wei: payment.amount.toString(),
    amount_usdc: fmtUsdc(payment.amount),
    paid_at_unix: Number(payment.timestamp),
    block: blockNumber,
    explorer: txLink(txHash),
  };
}

/** Shared redemption path once we have a candidate Paid event for a quote. */
function redeem(res, requestId, q, payment, txHash, blockNumber, entry) {
  if (payment.route !== q.routeHash)
    return res.status(409).json({ error: "route_mismatch", expected: q.routeHash, got: payment.route });
  if (BigInt(payment.amount) < q.amountWei)
    return res.status(402).json({
      error: "underpaid",
      required_wei: q.amountWei.toString(),
      paid_wei: payment.amount.toString(),
    });
  if (usedTxs.has(txHash) && usedTxs.get(txHash) !== requestId)
    return res.status(409).json({ error: "tx_already_redeemed", tx_hash: txHash });
  if (q.redeemed)
    return res.status(409).json({
      error: "request_already_redeemed",
      request_id: requestId,
      detail: "Each request_id unlocks exactly one response. Ask for a fresh quote.",
    });

  q.redeemed = true;
  q.txHash = txHash;
  usedTxs.set(txHash, requestId);

  res.json({
    request_id: requestId,
    paid: paidBlock(payment, txHash, blockNumber),
    data: entry.payload(),
  });
}

const app = express();
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "X-Arc-Payment, Content-Type");
  next();
});

app.get("/", (_req, res) => {
  res.json({
    name: "predge arc-gateway",
    description:
      "Pay-per-call gateway for Predge whale intelligence, settled natively in USDC on Circle Arc " +
      "through the PredgeSettlement contract. 402 quote -> on-chain payForRoute(routeHash, requestId) " +
      "-> retry -> the on-chain Paid receipt unlocks the data.",
    network: "arc-testnet",
    chain_id: Number(ARC_CHAIN_ID),
    contract: CONTRACT,
    explorer_contract: addressLink(CONTRACT),
    holds_private_key: false,
    endpoints: [
      ...Object.entries(CATALOG).map(([path, e]) => ({
        route: `GET ${path}`,
        price_usd: e.priceUsd,
        settles_as: e.route,
        description: e.description,
      })),
      { route: "GET /v1/status/:requestId", price_usd: "free", description: "Payment status of a quote (gateway scans Arc events)." },
      { route: "GET /v1/receipts/:txHash", price_usd: "free", description: "Decode any PredgeSettlement Paid receipt." },
      { route: "GET /health", price_usd: "free" },
    ],
    production_api: PREDGE_UPSTREAM,
    verification: `${PREDGE_UPSTREAM}/.well-known/predge-keys.json`,
  });
});

app.get("/health", async (_req, res) => {
  try {
    const block = await withRetry("blockNumber", () => provider.getBlockNumber());
    res.json({ status: "ok", chain_id: Number(ARC_CHAIN_ID), latest_block: block, contract: CONTRACT });
  } catch (e) {
    res.status(503).json({ status: "degraded", detail: e.shortMessage || e.message });
  }
});

// ---- paywalled catalog routes ------------------------------------------------
for (const [path, entry] of Object.entries(CATALOG)) {
  app.get(path, async (req, res) => {
    try {
      const txHash = req.get("X-Arc-Payment");
      const requestIdParam = String(req.query.request_id || "");

      // Path A: client presents the payment tx hash.
      if (txHash) {
        const v = await verifyByTxHash(txHash);
        if (!v.ok) return res.status(402).json({ error: v.code, detail: v.detail });
        const requestId = v.meta;
        const q = quotes.get(requestId);
        if (!q || q.path !== path)
          return res.status(402).json({
            error: "unknown_request_id",
            detail: `Paid memo "${requestId}" doesn't match an open quote for ${path}. Quotes live ${QUOTE_TTL_MS / 60000} min.`,
          });
        return redeem(res, requestId, q, v, txHash, v.receipt.blockNumber, entry);
      }

      // Path B: client only knows its request_id — the gateway watches the chain.
      if (requestIdParam) {
        const q = quotes.get(requestIdParam);
        if (!q || q.path !== path)
          return res.status(402).json({ error: "unknown_request_id" });
        if (q.redeemed)
          return res.status(409).json({ error: "request_already_redeemed", request_id: requestIdParam });
        const found = await scanForPayment(requestIdParam, q);
        if (!found.ok)
          return res.status(402).json({
            error: "payment_not_found",
            request_id: requestIdParam,
            detail: "No Paid event with this request_id memo on-chain yet. Pay first, or wait a block.",
          });
        return redeem(res, requestIdParam, q, found, found.txHash, found.blockNumber, entry);
      }

      // No payment evidence: quote it.
      const { requestId, q } = await makeQuote(path, entry);
      res.status(402).json(paymentInstructions(requestId, q));
    } catch (e) {
      console.error("gateway error:", e);
      res.status(500).json({ error: "gateway_error", detail: e.shortMessage || e.message });
    }
  });
}

// ---- free helpers ------------------------------------------------------------
app.get("/v1/status/:requestId", async (req, res) => {
  const requestId = req.params.requestId;
  const q = quotes.get(requestId);
  if (!q) return res.status(404).json({ error: "unknown_request_id" });
  if (q.redeemed)
    return res.json({ request_id: requestId, status: "redeemed", tx_hash: q.txHash, explorer: q.txHash ? txLink(q.txHash) : null });
  try {
    const found = await scanForPayment(requestId, q);
    if (found.ok)
      return res.json({ request_id: requestId, status: "paid", tx_hash: found.txHash, explorer: txLink(found.txHash) });
    res.json({ request_id: requestId, status: "pending", expires_at: q.expiresAt });
  } catch (e) {
    res.status(503).json({ error: "scan_failed", detail: e.shortMessage || e.message });
  }
});

app.get("/v1/receipts/:txHash", async (req, res) => {
  try {
    const v = await verifyByTxHash(req.params.txHash);
    if (!v.ok) return res.status(404).json({ error: v.code, detail: v.detail });
    res.json({ receipt: paidBlock(v, req.params.txHash, v.receipt.blockNumber), meta: v.meta });
  } catch (e) {
    res.status(503).json({ error: "lookup_failed", detail: e.shortMessage || e.message });
  }
});

app.listen(PORT, () => {
  console.log(`predge arc-gateway listening on http://localhost:${PORT}`);
  console.log(`  chain    ${ARC_CHAIN_ID} (arc-testnet)  rpc ${RPC}`);
  console.log(`  contract ${CONTRACT}`);
  console.log(`  key held NONE — read-only chain access; funds live in the contract`);
  for (const [path, e] of Object.entries(CATALOG))
    console.log(`  for sale GET ${path}  ${e.priceUsd}  (${e.route})`);
});
