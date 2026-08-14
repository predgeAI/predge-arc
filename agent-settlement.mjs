// Predge — the trust layer for AGENT SETTLEMENT on Arc, as a native ERC-8004 validator.
//
// The same commit-before-outcome guarantee that resolves prediction markets
// (oracle.mjs / PredgeOracle.sol), expressed through the STANDARD ERC-8004 Validation
// Registry surface (`validationRequest` / `validationResponse` / `getValidationStatus`)
// — so any ERC-8004 consumer settles against it with no adapter — plus the one property
// the commodity validator/receipt crowd cannot copy by matching JSON: the acceptance
// test is committed and chain-timestamped BEFORE the work is delivered.
//
//   ERC-8183 jobs settle on trust ("the client is also the evaluator").
//   ERC-8004's Validation Registry — the independent-validator piece — is the least-built.
//   x402 proves an agent PAID, not that it got what it paid for (foundation #2332).
//
// This is that validator, live on Arc:
//   1. validationRequest(requestHash = keccak256(signed acceptance test)) — recorded BEFORE
//      the worker delivers. The chain timestamps it; the verdict cannot be reverse-engineered.
//   2. the worker delivers → the validator runs the COMMITTED test → validationResponse with
//      an ed25519-signed, offline-verifiable attestation (responseHash) and a 0–100 score.
//   3. an escrow settles USDC off the free on-chain read — pays on 100, refunds on 0. The
//      response is written once; the validator cannot flip it after the money moves.
//
// Run:  node agent-settlement.mjs demo      (live on Arc testnet)
//
// ERC-8004 map: requestHash→acceptance test · responseHash→signed attestation ·
// response 0–100 (100 delivered / 0 failed / 50 void) · tag "predge/commit-before-outcome".
// ERC-8183 map: our validator address is the named evaluator; it calls complete(jobId, reason)
// / reject(jobId, reason) with reason = responseHash. (evaluator seat is assigned by the client.)
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { Contract, Wallet, keccak256, toUtf8Bytes } from "ethers";
import { makeProvider, withRetry, txLink, addressLink, EXPLORER } from "./lib/arc.mjs";
import { verifyAttestation } from "./vault/attest.mjs";
import { signedHash } from "./oracle.mjs";

const ENV = new URL(".env", import.meta.url).pathname;
const DEPLOYMENT = new URL("oracle/validator-deployment.json", import.meta.url).pathname;

// Predge verdict → ERC-8004 uint8 score.
const SCORE = { delivered: 100, failed: 0, void: 50 };
const scoreName = (s, has) => (!has ? "PENDING" : s >= 100 ? "DELIVERED" : s === 0 ? "FAILED" : `SCORE ${s}`);

const VALIDATOR_ABI = [
  "function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash) external",
  "function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag) external",
  "function getValidationStatus(bytes32 requestHash) view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)",
  "function isValidated(bytes32 requestHash) view returns (bool)",
  "function commitLeadTime(bytes32 requestHash) view returns (uint64)",
  "function requestCount() view returns (uint64)",
  "function responseCount() view returns (uint64)",
  "function validator() view returns (address)",
  "event ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestURI, bytes32 indexed requestHash)",
  "event ValidationResponse(address indexed validatorAddress, uint256 indexed agentId, bytes32 indexed requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag)",
  "error NotOwner()",
  "error NotValidator()",
  "error ZeroAddress()",
  "error ZeroHash()",
  "error AlreadyRequested()",
  "error NotRequested()",
  "error AlreadyResponded()",
  "error BadScore()",
];

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function connect() {
  const env = parseEnv(ENV);
  if (!existsSync(DEPLOYMENT)) {
    console.error("No oracle/validator-deployment.json — run `node script/deploy-validator.mjs` first.");
    process.exit(1);
  }
  const dep = JSON.parse(readFileSync(DEPLOYMENT, "utf8"));
  const provider = makeProvider(env.ARC_RPC);
  const pk = env.ORACLE_PUBLISHER_KEY || env.PRIVATE_KEY;
  if (!pk) {
    console.error("No PRIVATE_KEY / ORACLE_PUBLISHER_KEY in .env.");
    process.exit(1);
  }
  const wallet = new Wallet(pk, provider);
  return { wallet, address: dep.address, contract: new Contract(dep.address, VALIDATOR_ABI, wallet) };
}

const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const AGENT_ID = 1n; // the ERC-8004 agent under validation (illustrative)

function revertName(e) {
  if (e?.revert?.name) return e.revert.name;
  const s = (e?.shortMessage || e?.message || "") + " " + (e?.info?.error?.message || "");
  const m = /(AlreadyResponded|NotRequested|AlreadyRequested|NotValidator|NotOwner|BadScore|ZeroHash)/.exec(s);
  return m ? m[1] : (e?.shortMessage || "reverted");
}

/** Commit the signed acceptance test as an ERC-8004 validationRequest — BEFORE the work. */
async function requestValidation(contract, validatorAddr, { jobId, task, priceUsdc, expectedSha256 }) {
  const { att, hash } = signedHash({
    kind: "job-precommit",
    jobId,
    task,
    price_usdc: priceUsdc,
    acceptance: { test: "sha256(deliverable) == expected", expected_sha256: expectedSha256 },
    committed_at: new Date().toISOString(),
  });
  console.log("      requestHash  ", hash, "(keccak256 of the signed acceptance test)");
  console.log("      signature ok ", verifyAttestation(att).valid);
  const tx = await withRetry("validationRequest", () =>
    contract.validationRequest(validatorAddr, AGENT_ID, `https://predge.io/job/${jobId}`, hash),
  );
  await withRetry("wait", () => tx.wait());
  console.log("      requested    ", txLink(tx.hash), "(ERC-8004 ValidationRequest)");
  return hash;
}

/** Run the committed test and record the verdict as an ERC-8004 validationResponse. */
async function respondValidation(contract, requestHash, { expectedSha256, deliverable }) {
  const gotSha256 = sha256(Buffer.from(deliverable));
  const passed = gotSha256 === expectedSha256;
  const verdict = passed ? "delivered" : "failed";
  const score = SCORE[verdict];

  const { att, hash } = signedHash({
    kind: "job-attestation",
    verdict,
    score,
    expected_sha256: expectedSha256,
    delivered_sha256: gotSha256,
    check: "sha256(deliverable) == expected",
    resolved_at: new Date().toISOString(),
  });
  console.log(`      validator ran the committed test → ${gotSha256.slice(0, 16)}… ${passed ? "==" : "!="} expected`);
  console.log(`      response     score ${score}/100 (${verdict.toUpperCase()})  responseHash ${hash.slice(0, 18)}…`);
  const evidence = JSON.stringify({ canonical: att.canonical, signature: att.signature, public_key: att.public_key });
  const tx = await withRetry("validationResponse", () =>
    contract.validationResponse(requestHash, score, evidence, hash, "predge/commit-before-outcome"),
  );
  await withRetry("wait", () => tx.wait());
  console.log("      responded    ", txLink(tx.hash), "(ERC-8004 ValidationResponse)");
  return { att, score };
}

/** An escrow settling off the free ERC-8004 read. */
async function escrowSettle(contract, requestHash, { worker, client, priceUsdc }) {
  const st = await withRetry("getValidationStatus", () => contract.getValidationStatus(requestHash));
  const score = Number(st[2]);
  const lead = await withRetry("commitLeadTime", () => contract.commitLeadTime(requestHash));
  if (score >= 100) {
    console.log(`      escrow → RELEASE ${priceUsdc} USDC to worker ${worker}  (score 100, DELIVERED)`);
  } else if (score === 0) {
    console.log(`      escrow → REFUND ${priceUsdc} USDC to client ${client}  (score 0, FAILED — worker paid nothing)`);
  }
  console.log(`      test was committed ${Number(lead)}s before the verdict — proven by the chain`);
}

async function cmdDemo() {
  const { contract, address, wallet } = connect();
  const validatorAddr = await withRetry("validator", () => contract.validator());
  const stamp = Date.now();
  const client = "0xC1ien7…agent";
  const worker = "0xW0rker…agent";

  console.log(`Predge — ERC-8004 validator with commit-before-outcome · ${addressLink(address)}\n`);

  // ── Refusal #1: no verdict on un-requested work ──────────────────────────
  console.log("[1/6] a verdict on work that was never REQUESTED is refused (no hindsight validation)");
  try {
    await contract.validationResponse.staticCall(keccak256(toUtf8Bytes(`orphan-${stamp}`)), 100, "", keccak256(toUtf8Bytes("x")), "t");
    console.log("      UNEXPECTED: it did not revert\n");
  } catch (e) {
    console.log("      reverted:", revertName(e), "— the validator cannot bless work it never committed to judge\n");
  }

  // ── Job A: the worker delivers what was asked ────────────────────────────
  const wantA = Buffer.from("SELECT count(*) FROM trades WHERE size>10000; -> 4213 rows extracted");
  const expA = sha256(wantA);
  console.log("[2/6] validationRequest — the signed acceptance test, committed BEFORE work (Job A)");
  const reqA = await requestValidation(contract, validatorAddr, { jobId: `A-${stamp}`, task: "extract-large-trades", priceUsdc: "0.05", expectedSha256: expA });
  console.log();
  console.log("[3/6] worker delivers the correct result → validationResponse, escrow releases");
  await respondValidation(contract, reqA, { expectedSha256: expA, deliverable: wantA });
  await escrowSettle(contract, reqA, { worker, client, priceUsdc: "0.05" });
  console.log();

  // ── Job B: the worker delivers garbage — the validator scores 0 ──────────
  const wantB = Buffer.from("deliver the audited Q2 revenue figure: 1,284,300 USDC");
  const expB = sha256(wantB);
  const garbage = Buffer.from("lol here is a random number 42");
  console.log("[4/6] validationRequest for Job B (same commit-before-outcome flow)");
  const reqB = await requestValidation(contract, validatorAddr, { jobId: `B-${stamp}`, task: "audited-q2-revenue", priceUsdc: "0.20", expectedSha256: expB });
  console.log();
  console.log("[5/6] worker delivers WRONG bytes → validationResponse score 0, escrow refunds");
  const b = await respondValidation(contract, reqB, { expectedSha256: expB, deliverable: garbage });
  await escrowSettle(contract, reqB, { worker, client, priceUsdc: "0.20" });
  console.log("      → a machine can't squint at a wrong answer; the committed test catches it, signed and on-chain\n");

  // ── Refusal #2 + offline verify ──────────────────────────────────────────
  console.log("[6/6] the verdict CANNOT be rewritten, and anyone can verify it offline");
  try {
    await contract.validationResponse.staticCall(reqB, 100, "", keccak256(toUtf8Bytes("x")), "t");
    console.log("      UNEXPECTED: a rewrite succeeded");
  } catch (e) {
    console.log("      reverted:", revertName(e), "— the validator cannot flip score 0 → 100 after the fact");
  }
  console.log("      offline check of Job B's signed attestation:", verifyAttestation(b.att).valid ? "signature valid ✓" : "INVALID");

  const [rq, rs] = await Promise.all([
    withRetry("requestCount", () => contract.requestCount()),
    withRetry("responseCount", () => contract.responseCount()),
  ]);
  console.log(`\ntotals: ${rq} requests, ${rs} responses · ${EXPLORER}/address/${address}`);
  console.log("a native ERC-8004 Validation Registry the stack currently mocks — with commit-before-outcome, live on Arc.");
}

const isEntry = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "demo") await cmdDemo();
  else
    console.log(
      [
        "Predge — trust layer for agent settlement on Arc (native ERC-8004 validator)",
        "",
        "  node agent-settlement.mjs demo    validationRequest → deliver → validationResponse → escrow, live on Arc",
        "",
        "Standard ERC-8004 surface + commit-before-outcome — the guarantee the receipt/validator crowd lacks.",
      ].join("\n"),
    );
}
