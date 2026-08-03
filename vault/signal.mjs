// SENSE — obtain a SIGNED smart-money consensus for the vault to act on.
//
// Two modes:
//   LIVE   (--live, needs BUYER_PRIVATE_KEY): pays $0.03 USDC for
//          GET /v1/signals/consensus over x402 (same pattern as
//          predge-x402-api/mcp/pay.ts and predge-keeperhub-agent), then returns
//          the server's ed25519 attestation to be verified + pinned against the
//          live /.well-known/predge-keys.json registry.
//   SAMPLE (default): loads a frozen consensus in the exact production shape and
//          SELF-SIGNS it with an ephemeral ed25519 key. Clearly labeled demo=true
//          — this is NOT the live Predge key; it exists so the whole verify path
//          (JCS canonicalisation + node:crypto ed25519) runs end-to-end offline
//          with zero keys and zero spend.
import { readFileSync } from "node:fs";
import { config } from "./config.mjs";
import { SAMPLE_CONSENSUS } from "./samples.mjs";
import { ephemeralKeypair, fetchRegistry, signAttestation } from "./attest.mjs";

/** LIVE: build an x402-paying fetch. Deps are dynamically imported so the
 *  default (sample) path needs none of them installed. */
async function payingFetch() {
  if (!config.buyerKey) {
    throw new Error(
      "LIVE mode needs BUYER_PRIVATE_KEY (a funded Base-mainnet USDC wallet; the facilitator pays gas). " +
        "Run without --live for the self-signed sample.",
    );
  }
  let fetchMod, evmMod, viemMod;
  try {
    fetchMod = await import("@x402/fetch");
    evmMod = await import("@x402/evm/exact/client");
    viemMod = await import("viem/accounts");
  } catch {
    throw new Error(
      "LIVE mode requires the x402 client libraries. Install them first:\n" +
        "  npm install @x402/fetch @x402/evm viem\n" +
        "then re-run with --live. (The default sample path needs none of these.)",
    );
  }
  const { wrapFetchWithPayment, x402Client } = fetchMod;
  const { ExactEvmScheme } = evmMod;
  const { privateKeyToAccount } = viemMod;
  const NET = { base: "eip155:8453", "base-sepolia": "eip155:84532" }[config.x402Network] ?? config.x402Network;

  const amountUsd = (r) => {
    const a = r.amount ?? r.maxAmountRequired;
    try { return a ? Number(BigInt(a)) / 1e6 : null; } catch { return null; }
  };
  const client = new x402Client((_v, reqs) => {
    const onNet = reqs.filter((r) => (r.scheme ?? "exact") === "exact" && r.network === NET);
    if (!onNet.length) throw new Error(`no payment option on ${NET}; offered ${reqs.map((r) => r.network).join(", ") || "none"}`);
    const chosen = onNet.reduce((a, b) => ((amountUsd(a) ?? Infinity) <= (amountUsd(b) ?? Infinity) ? a : b));
    const price = amountUsd(chosen);
    if (price !== null && price > config.maxPriceUsd) {
      throw new Error(`price $${price.toFixed(3)} exceeds MAX_PRICE_USD $${config.maxPriceUsd.toFixed(3)} — refusing to pay`);
    }
    return chosen;
  });
  client.register("eip155:*", new ExactEvmScheme(privateKeyToAccount(config.buyerKey)));
  return wrapFetchWithPayment(fetch, client);
}

/** Return { attestation, registry, source, paid, demo, note }. */
export async function getSignedConsensus({ live = false, sample = "riskon" } = {}) {
  if (live) {
    const f = await payingFetch();
    const url = `${config.predgeBaseUrl}${config.consensusRoute}`;
    const res = await f(url, { method: "GET", headers: { "user-agent": config.userAgent } });
    if (res.status >= 400) throw new Error(`upstream ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const body = await res.json();
    const attestation = body.attestation ?? body;
    if (!attestation?.canonical || !attestation?.signature) {
      throw new Error("live response carried no ed25519 attestation (expected body.attestation with canonical+signature)");
    }
    const registry = await fetchRegistry(config.registryUrl);
    let paid = null;
    const hdr = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
    if (hdr) paid = { header: hdr.slice(0, 40) + "…" };
    return { attestation, registry, source: `live:x402 ${url}`, paid, demo: false, note: "live Predge attestation" };
  }

  // ---- SAMPLE: self-signed, clearly labeled ----
  const payload =
    sample && SAMPLE_CONSENSUS[sample] ? SAMPLE_CONSENSUS[sample] : loadSampleFile(sample);
  const { privateKey, publicKey } = ephemeralKeypair();
  const attestation = signAttestation(payload, privateKey, publicKey, {
    issuer: "sample.local",
    sample: true,
  });
  // Synthetic single-key registry so key-pinning still runs — but it pins to the
  // ephemeral demo key, never to Predge's production key.
  const registry = {
    issuer: "sample.local",
    version: "predge-attest-v1",
    keys: [{ kid: "sample-demo", algorithm: "ed25519", public_key: attestation.public_key, active: true }],
  };
  return {
    attestation,
    registry,
    source: `sample:${SAMPLE_CONSENSUS[sample] ? sample : sample}`,
    paid: null,
    demo: true,
    note: "SELF-SIGNED SAMPLE — ephemeral demo key, NOT the live Predge key. Set BUYER_PRIVATE_KEY + --live for the real signed feed.",
  };
}

function loadSampleFile(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    throw new Error(`unknown sample "${p}" (use riskon|riskoff|neutral or a path to a consensus JSON)`);
  }
}
