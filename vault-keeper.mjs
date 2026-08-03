#!/usr/bin/env node
// vault-keeper.mjs — the autonomous agent behind PredgeSignalVault.
//
//   sense   -> obtain a SIGNED smart-money consensus (live x402, or a clearly
//              labeled self-signed sample)
//   verify  -> check the ed25519 attestation OFF-chain (node:crypto) and pin the
//              key to Predge's live registry — the vault NEVER rebalances on an
//              unverified signal
//   decide  -> transparent threshold rule on net_flow / smart_wallets / direction
//              -> target posture SHORT | FLAT | LONG
//   act     -> call PredgeSignalVault.rebalance(signalHash, direction, ref) on Arc,
//              committing the exact signed bytes' hash + an attestation reference
//              on-chain for a fully auditable decision history
//
// Commands
//   run                 full cycle: sense -> verify -> decide -> rebalance
//   sense               fetch + verify a signal, print it, touch no chain
//   decide              sense + read on-chain posture + print the verdict only
//   deposit <usdc>      deposit native USDC into the vault (depositor wallet)
//   state               read the vault's on-chain state
//   smoke               zero-spend connectivity check of every surface
//
// Flags
//   --live              pay for the real signed consensus (needs BUYER_PRIVATE_KEY)
//   --sample <name>     riskon | riskoff | neutral | <path>   (default riskon)
//   --simulate          decide + verify but DO NOT send the Arc rebalance tx
//   --vault <address>   override VAULT_ADDRESS / deployment.json
//   --json              print the machine-readable cycle result
import { appendFileSync, mkdirSync } from "node:fs";
import { config } from "./vault/config.mjs";
import { getSignedConsensus } from "./vault/signal.mjs";
import { verifyAndPin } from "./vault/attest.mjs";
import { decide, POSTURE_NAME } from "./vault/decide.mjs";
import {
  attestationRef,
  deposit,
  readState,
  rebalance,
  signalHashFromCanonical,
} from "./vault/vault.mjs";
import { fmtUsdc } from "./lib/arc.mjs";
import { parseEther } from "ethers";

const [, , command = "run", ...rest] = process.argv;
const flags = { _: [] };
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith("--")) { flags._.push(a); continue; }
  const name = a.slice(2);
  const needsValue = ["sample", "vault"].includes(name);
  flags[name] = needsValue ? rest[++i] : true;
}
if (flags.vault) config.vaultAddress = flags.vault;

const log = (k, m) => process.stderr.write(`[${k.toUpperCase().padEnd(6)}] ${m}\n`);
const hr = () => process.stderr.write("-".repeat(72) + "\n");
const LOG_DIR = new URL("./logs/", import.meta.url).pathname;
function journal(entry) {
  mkdirSync(LOG_DIR, { recursive: true });
  appendFileSync(`${LOG_DIR}vault-decisions.jsonl`, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

// Obtain + verify a signal; returns { att, signed, verdict, source, demo }.
async function senseAndVerify() {
  const sample = typeof flags.sample === "string" ? flags.sample : "riskon";
  const { attestation, registry, source, demo, note } = await getSignedConsensus({ live: Boolean(flags.live), sample });
  log("sense", `signal source: ${source}`);
  if (demo) log("warn", note);

  const verdict = verifyAndPin(attestation, registry);
  log("verify", `${verdict.ok ? "OK" : "FAILED"} — ${verdict.reason}${verdict.kid ? ` (kid ${verdict.kid})` : ""}`);
  if (!verdict.ok) throw new Error(`attestation did not verify — refusing to act (${verdict.reason})`);

  // Act on EXACTLY what was signed.
  const signed = JSON.parse(attestation.canonical);
  const c = signed;
  log("sense", `consensus: ${c.markets?.length ?? 0} market(s), window ${c.window_hours}h, ${c.scored_wallets_total} scored wallets`);
  for (const m of (c.markets ?? []).slice(0, 3)) {
    log("sense", `  ${String(m.direction).toUpperCase().padEnd(5)} net $${String(Math.round(m.net_flow_usd)).padStart(8)} (${m.smart_wallets} smart) — ${m.title ?? m.condition_id}`);
  }
  return { att: attestation, signed, verdict, source, demo };
}

async function doDecide(currentPosture) {
  const s = await senseAndVerify();
  const decision = decide(s.signed, currentPosture, config);
  log("decide", `${decision.action}: ${decision.reason}`);
  return { ...s, decision };
}

async function cycle() {
  hr();
  const before = await readState();
  log("info", `vault ${before.address} — posture ${POSTURE_NAME[String(before.posture)]}, ${before.totalDepositsUsdc} USDC deposited, rebalances ${before.rebalanceCount}`);

  const { att, signed, verdict, source, demo, decision } = await doDecide(before.posture);

  let action = null;
  if (decision.action === "REBALANCE" && !flags.simulate) {
    const signalHash = signalHashFromCanonical(att.canonical);
    const ref = attestationRef(att, { demo, kid: verdict.kid });
    log("act", `rebalance(${signalHash.slice(0, 18)}…, ${decision.direction}, "${ref.slice(0, 48)}…")`);
    action = await rebalance(signalHash, decision.direction, ref);
    log("ok", `posture ${POSTURE_NAME[String(before.posture)]} -> ${decision.targetName} in block ${action.block}`);
    log("ok", action.link);
  } else if (decision.action === "REBALANCE") {
    log("info", "SIMULATE — would rebalance, but --simulate set (no tx sent)");
  } else {
    log("info", "no rebalance needed this cycle");
  }

  const after = flags.simulate ? before : await readState();
  const entry = {
    kind: "cycle",
    source,
    demo,
    signalHash: signalHashFromCanonical(att.canonical),
    attestation: { public_key: att.public_key, signature: att.signature, canonical: att.canonical, kid: verdict.kid ?? null, verified: verdict.ok, pinned: verdict.pinned },
    decision: {
      action: decision.action,
      target: decision.targetName,
      direction: decision.direction,
      current: POSTURE_NAME[String(decision.current)],
      reason: decision.reason,
      market: decision.market ? { condition_id: decision.market.condition_id, title: decision.market.title, direction: decision.market.direction, net_flow_usd: decision.market.net_flow_usd, smart_wallets: decision.market.smart_wallets } : null,
      thresholds: decision.thresholds,
    },
    tx: action,
    posture_after: POSTURE_NAME[String(after.posture)],
  };
  journal(entry);
  hr();
  log("ok", "cycle complete — journal appended to logs/vault-decisions.jsonl");
  if (flags.json) process.stdout.write(JSON.stringify(entry, null, 2) + "\n");
}

async function smoke() {
  hr();
  log("info", "smoke — zero spend, nothing signed on-chain");
  let fails = 0;
  const check = async (label, fn) => {
    try { log("ok", `${label} — ${await fn()}`); } catch (e) { fails++; log("warn", `${label} FAILED — ${e.message}`); }
  };
  await check("Predge key registry reachable", async () => {
    const r = await fetch(config.registryUrl, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    return `${j.keys?.length ?? 0} key(s), active kid ${j.keys?.find((k) => k.active !== false)?.kid ?? "?"}`;
  });
  await check("consensus route challenges with 402", async () => {
    const r = await fetch(`${config.predgeBaseUrl}${config.consensusRoute}`, { signal: AbortSignal.timeout(15000) });
    if (r.status !== 402) throw new Error(`expected 402, got ${r.status}`);
    return "unpaid call returns HTTP 402 (as designed)";
  });
  await check("self-signed sample verifies end-to-end", async () => {
    const { attestation, registry } = await getSignedConsensus({ live: false, sample: "riskon" });
    const v = verifyAndPin(attestation, registry);
    if (!v.ok) throw new Error(v.reason);
    return "ed25519 verify + key-pin OK on the offline sample";
  });
  await check("Arc vault reachable", async () => {
    const s = await readState();
    return `posture ${POSTURE_NAME[String(s.posture)]}, ${s.totalDepositsUsdc} USDC, rebalances ${s.rebalanceCount}`;
  });
  await check("credentials", async () => {
    const missing = [];
    if (!config.keeperKey) missing.push("PRIVATE_KEY (keeper: rebalance on Arc)");
    if (!config.buyerKey) missing.push("BUYER_PRIVATE_KEY (live x402 consensus — sample path works without it)");
    if (missing.length) throw new Error(missing.join("; "));
    return "keeper + buyer keys present";
  });
  hr();
  log(fails ? "warn" : "ok", fails ? `${fails} check(s) failed` : "every surface reachable");
}

try {
  switch (command) {
    case "run":
      await cycle();
      break;
    case "sense": {
      const s = await senseAndVerify();
      if (flags.json) process.stdout.write(JSON.stringify({ source: s.source, demo: s.demo, verified: s.verdict.ok, signed: s.signed }, null, 2) + "\n");
      break;
    }
    case "decide": {
      const st = await readState();
      const d = await doDecide(st.posture);
      if (flags.json) process.stdout.write(JSON.stringify(d.decision, null, 2) + "\n");
      break;
    }
    case "deposit": {
      const amt = flags._[0];
      if (!amt) throw new Error("usage: vault-keeper deposit <usdc>  (e.g. deposit 0.01)");
      const wei = parseEther(String(amt));
      log("act", `deposit ${amt} USDC into ${config.vaultAddress}`);
      const r = await deposit(wei);
      log("ok", `deposited in block ${r.block} — ${r.link}`);
      break;
    }
    case "state": {
      const s = await readState();
      log("info", `vault ${s.address}`);
      log("info", `posture ${POSTURE_NAME[String(s.posture)]} (${s.posture}), rebalances ${s.rebalanceCount}, deposited ${s.totalDepositsUsdc} USDC, paused ${s.paused}`);
      log("info", `lastSignalHash ${s.lastSignalHash}`);
      log("info", `lastAttestationRef ${s.lastAttestationRef || "(none yet)"}`);
      if (flags.json) process.stdout.write(JSON.stringify({ ...s, totalDeposits: fmtUsdc(s.totalDeposits) }, null, 2) + "\n");
      break;
    }
    case "smoke":
      await smoke();
      break;
    default:
      throw new Error(`unknown command "${command}" (run|sense|decide|deposit|state|smoke)`);
  }
  process.exit(0);
} catch (e) {
  log("warn", e.message);
  journal({ kind: "error", command, error: e.message });
  process.exit(1);
}
