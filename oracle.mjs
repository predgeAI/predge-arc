// PredgeOracle publisher CLI — the outcome-resolution layer for prediction
// markets on Circle Arc.
//
// Commands:
//   node oracle.mjs commit  <platform> <marketRef> [--ref <url>]   pre-commit a call
//   node oracle.mjs resolve <platform> <marketRef> <yes|no|invalid> [--ref <url>]
//   node oracle.mjs read    <platform> <marketRef>                 free view
//   node oracle.mjs demo                                           full loop + proofs
//
// WHY THIS SHAPE. A resolution is only trustworthy if it could not have been
// chosen with hindsight. So the publisher must COMMIT to its ed25519-signed call
// while the market is still open (the chain timestamps it), and only later post
// the settled outcome — which the contract refuses to accept for an uncommitted
// market, and refuses to overwrite once written. `demo` proves both refusals on
// a live chain, because a guarantee you cannot watch fail is just a claim.
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { AbiCoder, Contract, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { makeProvider, withRetry, txLink, addressLink, EXPLORER } from "./lib/arc.mjs";
import { canonicalJson, ephemeralKeypair, signAttestation, verifyAttestation } from "./vault/attest.mjs";

const ENV = new URL(".env", import.meta.url).pathname;
const DEPLOYMENT = new URL("oracle/deployment.json", import.meta.url).pathname;

export const ORACLE_ABI = [
  "function commitMarket(bytes32 marketId, bytes32 preCommitHash, string marketRef) external",
  "function postResolution(bytes32 marketId, uint8 outcome, bytes32 contentHash, string evidenceRef) external",
  "function getResolution(bytes32 marketId) view returns (bool resolved, uint8 outcome, bytes32 contentHash, bytes32 preCommitHash, uint64 committedAt, uint64 resolvedAt)",
  "function isResolved(bytes32 marketId) view returns (bool)",
  "function isCommitted(bytes32 marketId) view returns (bool)",
  "function commitLeadTime(bytes32 marketId) view returns (uint64)",
  "function outcomeOf(bytes32 marketId) view returns (uint8)",
  "function commitCount() view returns (uint64)",
  "function resolutionCount() view returns (uint64)",
  "function publisher() view returns (address)",
  "event MarketCommitted(bytes32 indexed marketId, bytes32 indexed preCommitHash, uint64 committedAt, string marketRef)",
  "event MarketResolved(bytes32 indexed marketId, uint8 indexed outcome, bytes32 indexed contentHash, bytes32 preCommitHash, uint64 committedAt, uint64 resolvedAt, string attestationRef)",
  // The custom errors MUST be in the ABI or ethers reports a bare "unknown custom
  // error" — and the whole point of the demo is watching the chain refuse by NAME.
  "error NotOwner()",
  "error NotPublisher()",
  "error ZeroAddress()",
  "error ZeroHash()",
  "error AlreadyCommitted()",
  "error NotCommitted()",
  "error AlreadyResolved()",
  "error BadOutcome()",
];

const OUTCOME = { unresolved: 0, yes: 1, no: 2, invalid: 3 };
const OUTCOME_NAME = ["UNRESOLVED", "YES", "NO", "INVALID"];

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * marketId exactly as the contract derives it: keccak256(abi.encode(platform, ref)).
 * ABI encoding is length-prefixed and therefore injective — a packed
 * "<platform>:<ref>" concatenation would collide, since ("a","b:c") and
 * ("a:b","c") pack identically and would share one write-once market slot.
 */
export function marketIdFor(platform, marketRef) {
  return keccak256(AbiCoder.defaultAbiCoder().encode(["string", "string"], [platform, marketRef]));
}

function loadDeployment() {
  if (!existsSync(DEPLOYMENT)) {
    console.error("No oracle/deployment.json — run `npm run deploy-oracle` first.");
    process.exit(1);
  }
  return JSON.parse(readFileSync(DEPLOYMENT, "utf8"));
}

function connect() {
  const env = parseEnv(ENV);
  const dep = loadDeployment();
  const provider = makeProvider(env.ARC_RPC);
  const pk = env.ORACLE_PUBLISHER_KEY || env.PRIVATE_KEY;
  if (!pk) {
    console.error("No PRIVATE_KEY in .env.");
    process.exit(1);
  }
  const wallet = new Wallet(pk, provider);
  return { provider, wallet, address: dep.address, contract: new Contract(dep.address, ORACLE_ABI, wallet) };
}

/**
 * Build a Predge-shaped ed25519 attestation and return both the signed bytes and
 * the keccak256 the chain will commit to. The on-chain hash is over the EXACT
 * canonical bytes, so anyone can re-fetch the attestation, verify the signature
 * offline against Predge's key registry, and confirm it hashes to what settled.
 */
export function signedHash(payload, keys) {
  const { privateKey, publicKey } = keys ?? signingKeypair();
  const att = signAttestation(payload, privateKey, publicKey);
  return { att, hash: keccak256(toUtf8Bytes(att.canonical)) };
}

/**
 * The keypair the oracle publishes under.
 *
 * With ORACLE_SIGNING_KEY set (64-hex ed25519 seed) it signs with a REAL key —
 * which must be the one listed active in Predge's published registry, or the
 * trust chain breaks: verify-cachet.mjs will confirm the signature and then
 * refuse the resolution at step 4, because a signature under an unpublished key
 * proves only that *someone* signed. Without it, this falls back to an ephemeral
 * throwaway key: fine for demonstrating the on-chain mechanics, and correctly
 * REJECTED by the verifier. That rejection is the system working, not a bug.
 */
export function signingKeypair() {
  const seed = (process.env.ORACLE_SIGNING_KEY || parseEnv(ENV).ORACLE_SIGNING_KEY || "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(seed)) return ephemeralKeypair();
  const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(seed, "hex")]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey };
}

const arg = (flag, dflt = "") => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : dflt;
};
const has = (flag) => process.argv.includes(flag);

async function cmdCommit(platform, marketRef) {
  const { contract, wallet } = connect();
  const marketId = marketIdFor(platform, marketRef);
  // The pre-outcome call: signed while the market is still OPEN.
  const { att, hash } = signedHash({
    kind: "market-precommit",
    platform,
    market: marketRef,
    committed_at: new Date().toISOString(),
  });
  console.log("marketId      ", marketId);
  console.log("preCommitHash ", hash, "(keccak256 of the signed call bytes)");
  console.log("signature ok  ", verifyAttestation(att).valid);
  const ref = arg("--ref", `https://predge.io/r/${marketRef}`);
  const tx = await withRetry("commitMarket", () => contract.commitMarket(marketId, hash, ref));
  console.log("commit tx     ", txLink(tx.hash));
  await withRetry("wait", () => tx.wait());
  console.log("committed by  ", wallet.address);
}

async function cmdResolve(platform, marketRef, outcomeWord) {
  const { contract } = connect();
  const outcome = OUTCOME[String(outcomeWord).toLowerCase()];
  if (!outcome) {
    console.error("outcome must be yes | no | invalid");
    process.exit(1);
  }
  const marketId = marketIdFor(platform, marketRef);
  const { att, hash } = signedHash({
    kind: "market-resolution",
    platform,
    market: marketRef,
    outcome: String(outcomeWord).toLowerCase(),
    resolved_at: new Date().toISOString(),
  });
  console.log("marketId    ", marketId);
  console.log("contentHash ", hash, "(keccak256 of the signed resolution bytes)");
  console.log("signature ok", verifyAttestation(att).valid);
  // --embed writes the ENTIRE signed envelope on-chain instead of a URL pointing
  // at it. It costs more gas, and it is worth it: a hash whose preimage lives on
  // someone's web server proves only that *something* was committed. Embedded,
  // the resolution stays independently verifiable even if predge.io disappears —
  // which is the difference between "verify without trusting us" as a claim and
  // as a fact. See verify-cachet.mjs.
  const ref = has("--embed")
    ? JSON.stringify({ canonical: att.canonical, signature: att.signature, public_key: att.public_key })
    : arg("--ref", `https://predge.io/r/${marketRef}/evidence`);
  if (has("--embed")) console.log("embedding   ", ref.length, "bytes of signed envelope on-chain");
  const tx = await withRetry("postResolution", () => contract.postResolution(marketId, outcome, hash, ref));
  console.log("resolve tx  ", txLink(tx.hash));
  await withRetry("wait", () => tx.wait());
}

async function cmdRead(platform, marketRef) {
  const { contract } = connect();
  const marketId = marketIdFor(platform, marketRef);
  const r = await withRetry("getResolution", () => contract.getResolution(marketId));
  const lead = await withRetry("commitLeadTime", () => contract.commitLeadTime(marketId));
  console.log("marketId      ", marketId);
  console.log("resolved      ", r[0]);
  console.log("outcome       ", OUTCOME_NAME[Number(r[1])]);
  console.log("contentHash   ", r[2]);
  console.log("preCommitHash ", r[3]);
  console.log("committedAt   ", Number(r[4]), r[4] ? new Date(Number(r[4]) * 1000).toISOString() : "");
  console.log("resolvedAt    ", Number(r[5]), r[5] ? new Date(Number(r[5]) * 1000).toISOString() : "");
  console.log("commit lead   ", Number(lead), "s before the outcome was recorded");
}

/** Name of the custom error the chain reverted with (ethers v6 decodes it via the ABI). */
function revertName(e) {
  if (e?.revert?.name) return e.revert.name;
  const s = (e?.shortMessage || e?.message || "") + " " + (e?.info?.error?.message || "");
  const m = /(AlreadyResolved|NotCommitted|AlreadyCommitted|NotPublisher|NotOwner|BadOutcome|ZeroHash)/.exec(s);
  return m ? m[1] : (e?.shortMessage || "reverted");
}

/**
 * The whole point, on a live chain: commit -> resolve -> read, then show the two
 * refusals that make the record trustworthy — you cannot resolve a market that
 * was never pre-committed, and you cannot rewrite a resolution once written.
 */
async function cmdDemo() {
  const { contract, address } = connect();
  const stamp = Date.now();
  const platform = "polymarket";
  const marketRef = `demo-${stamp}`;
  const marketId = marketIdFor(platform, marketRef);

  console.log(`PredgeOracle  ${addressLink(address)}\n`);

  console.log("[1/5] a market that was never pre-committed CANNOT be resolved");
  const orphan = marketIdFor(platform, `orphan-${stamp}`);
  try {
    await contract.postResolution.staticCall(orphan, OUTCOME.yes, keccak256(toUtf8Bytes("x")), "");
    console.log("      UNEXPECTED: it did not revert\n");
  } catch (e) {
    console.log("      reverted:", revertName(e), "— hindsight resolution is impossible\n");
  }

  console.log("[2/5] commit the signed call while the market is still OPEN");
  const pre = signedHash({ kind: "market-precommit", platform, market: marketRef, committed_at: new Date().toISOString() });
  console.log("      preCommitHash", pre.hash);
  console.log("      signature ok ", verifyAttestation(pre.att).valid);
  let tx = await withRetry("commitMarket", () => contract.commitMarket(marketId, pre.hash, `https://predge.io/r/${marketRef}`));
  await withRetry("wait", () => tx.wait());
  console.log("      tx", txLink(tx.hash), "\n");

  console.log("[3/5] the outcome settles — post the signed resolution");
  const res = signedHash({ kind: "market-resolution", platform, market: marketRef, outcome: "yes", resolved_at: new Date().toISOString() });
  console.log("      contentHash  ", res.hash);
  tx = await withRetry("postResolution", () => contract.postResolution(marketId, OUTCOME.yes, res.hash, `https://predge.io/r/${marketRef}/evidence`));
  await withRetry("wait", () => tx.wait());
  console.log("      tx", txLink(tx.hash), "\n");

  console.log("[4/5] any Arc contract can now settle against it — free view");
  const r = await withRetry("getResolution", () => contract.getResolution(marketId));
  const lead = await withRetry("commitLeadTime", () => contract.commitLeadTime(marketId));
  console.log("      resolved:", r[0], "| outcome:", OUTCOME_NAME[Number(r[1])]);
  console.log("      committed", Number(lead), "s before the outcome was recorded — proven by the chain\n");

  console.log("[5/5] the resolution CANNOT be rewritten — not even by the publisher");
  try {
    await contract.postResolution.staticCall(marketId, OUTCOME.no, res.hash, "");
    console.log("      UNEXPECTED: a rewrite succeeded\n");
  } catch (e) {
    console.log("      reverted:", revertName(e), "— the record is permanent\n");
  }

  const [cc, rc] = await Promise.all([
    withRetry("commitCount", () => contract.commitCount()),
    withRetry("resolutionCount", () => contract.resolutionCount()),
  ]);
  console.log(`totals: ${cc} commitments, ${rc} resolutions · ${EXPLORER}/address/${address}`);
}

// Only run the CLI when executed directly — the pure helpers above are imported
// by oracle/test.mjs, which must not trigger a command or touch the chain.
const isEntry = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  const [cmd, a, b, c] = process.argv.slice(2);
  switch (cmd) {
    case "commit":
      await cmdCommit(a, b);
      break;
    case "resolve":
      await cmdResolve(a, b, c);
      break;
    case "read":
      await cmdRead(a, b);
      break;
    case "demo":
      await cmdDemo();
      break;
    default:
      console.log(
        [
          "PredgeOracle — verifiable outcome resolution for prediction markets on Arc",
          "",
          "  node oracle.mjs commit  <platform> <marketRef> [--ref <url>]",
          "  node oracle.mjs resolve <platform> <marketRef> <yes|no|invalid> [--ref <url>]",
          "  node oracle.mjs read    <platform> <marketRef>",
          "  node oracle.mjs demo",
        ].join("\n"),
      );
  }
}
