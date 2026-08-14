// Predge as an ERC-8183 EVALUATOR, live on Arc.
//
// ERC-8183 is Arc's agent-job standard, and its trust hole is stated outright: "the client
// is also the evaluator." This demo fills the evaluator seat with Predge — an INDEPENDENT
// authority whose verdict is committed-before-outcome, ed25519-signed, and (via the bond)
// slashable. The job settles USDC off that verdict:
//
//   createJob(evaluator = Predge, specHash = committed acceptance test) → provider submit()
//   → Predge runs the committed test, signs the verdict, and calls the standard ERC-8183
//     complete(jobId, reason) / reject(jobId, reason) — where `reason` = keccak256 of the
//     signed attestation, so an on-chain settlement points at an offline-verifiable proof.
//
// Run: node job.mjs demo    (live on Arc testnet)
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { Contract, Wallet, keccak256, toUtf8Bytes, parseEther, formatEther } from "ethers";
import { makeProvider, withRetry, txLink, addressLink, EXPLORER } from "./lib/arc.mjs";
import { verifyAttestation } from "./vault/attest.mjs";
import { signedHash } from "./oracle.mjs";

const ENV = new URL(".env", import.meta.url).pathname;
const DEPLOYMENT = new URL("oracle/job-deployment.json", import.meta.url).pathname;

const JOB_ABI = [
  "function createJob(address provider, address evaluator, bytes32 specHash) payable returns (uint256)",
  "function submit(uint256 jobId, bytes32 deliverable, bytes optParams) external",
  "function complete(uint256 jobId, bytes32 reason, bytes optParams) external",
  "function reject(uint256 jobId, bytes32 reason, bytes optParams) external",
  "function jobState(uint256 jobId) view returns (uint8 state, bytes32 specHash, bytes32 deliverable, bytes32 reason, uint96 escrow)",
  "function jobCount() view returns (uint256)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed evaluator, address provider, uint96 escrow, bytes32 specHash)",
  "event Completed(uint256 indexed jobId, bytes32 reason, address provider, uint96 paid)",
  "event Rejected(uint256 indexed jobId, bytes32 reason, address client, uint96 refunded)",
  "error ZeroAddress()","error ZeroEscrow()","error NotProvider()","error NotEvaluator()","error BadState()","error TransferFailed()",
];
const STATE = ["None", "Open", "Submitted", "Completed", "Rejected"];

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
  if (!existsSync(DEPLOYMENT)) { console.error("No oracle/job-deployment.json — run `node script/deploy-job.mjs`."); process.exit(1); }
  const dep = JSON.parse(readFileSync(DEPLOYMENT, "utf8"));
  const provider = makeProvider(env.ARC_RPC);
  const wallet = new Wallet(env.ORACLE_PUBLISHER_KEY || env.PRIVATE_KEY, provider);
  return { wallet, dep, contract: new Contract(dep.address, JOB_ABI, wallet) };
}

const sha256hex = (b) => "0x" + crypto.createHash("sha256").update(b).digest("hex");

function revertName(e) {
  if (e?.revert?.name) return e.revert.name;
  const s = (e?.shortMessage || e?.message || "") + " " + (e?.info?.error?.message || "");
  const m = /(NotEvaluator|NotProvider|BadState|ZeroEscrow|ZeroAddress)/.exec(s);
  return m ? m[1] : (e?.shortMessage || "reverted");
}

/** Predge, holding the evaluator seat, runs the committed test and signs the verdict. */
function evaluate(expectedSha256, deliverableBytes) {
  const gotSha256 = sha256hex(deliverableBytes).slice(2);
  const passed = "0x" + gotSha256 === "0x" + expectedSha256.slice(2);
  const verdict = passed ? "delivered" : "failed";
  const { att, hash } = signedHash({
    kind: "erc8183-verdict",
    verdict,
    expected_sha256: expectedSha256,
    delivered_sha256: "0x" + gotSha256,
    resolved_at: new Date().toISOString(),
  });
  return { passed, verdict, reason: hash, att };
}

async function cmdDemo() {
  const { wallet, dep, contract } = connect();
  const me = wallet.address; // one key plays client, provider, and the Predge evaluator seat
  const escrow = parseEther("0.001");
  const stamp = Date.now();
  console.log(`Predge as an ERC-8183 evaluator · AgentJob ${addressLink(dep.address)}`);
  console.log(`(demo: one operator plays client + provider + evaluator; in production these are three parties)\n`);

  // ── Job A — provider delivers correctly → complete → provider paid ───────
  const wantA = Buffer.from(`extract-large-trades ${stamp} -> 4213 rows`);
  const expA = sha256hex(wantA);
  const specA = signedHash({ kind: "job-precommit", task: "extract-large-trades", expected_sha256: expA, committed_at: new Date().toISOString() }).hash;
  console.log("[1/5] client opens an ERC-8183 job, escrows USDC, names Predge as the INDEPENDENT evaluator");
  let tx = await withRetry("createJob", () => contract.createJob(me, me, specA, { value: escrow }));
  let rc = await withRetry("wait", () => tx.wait());
  const jobA = (await withRetry("jobCount", () => contract.jobCount())).toString();
  console.log(`      job #${jobA} · escrow ${formatEther(escrow)} · specHash committed  ${txLink(tx.hash)}`);
  tx = await withRetry("submit", () => contract.submit(jobA, keccak256(wantA), "0x"));
  await withRetry("wait", () => tx.wait());
  console.log("      provider submitted a deliverable\n");

  console.log("[2/5] only the named evaluator may settle — a stranger calling complete is refused");
  try {
    // Read-only, provider-connected instance so the call actually reaches the contract
    // (a Wallet-connected staticCall would reject the from-override client-side instead).
    const ro = contract.connect(wallet.provider);
    await ro.complete.staticCall(jobA, keccak256(toUtf8Bytes("x")), "0x", { from: Wallet.createRandom().address });
    console.log("      UNEXPECTED: did not revert");
  } catch (e) {
    console.log("      reverted:", revertName(e), "— the evaluator seat is not the client's to take\n");
  }

  console.log("[3/5] Predge runs the COMMITTED test, signs the verdict, and calls ERC-8183 complete()");
  const evA = evaluate(expA, wantA);
  console.log(`      verdict ${evA.verdict.toUpperCase()} · signature ok ${verifyAttestation(evA.att).valid} · reason ${evA.reason.slice(0, 18)}…`);
  tx = await withRetry("complete", () => contract.complete(jobA, evA.reason, "0x"));
  await withRetry("wait", () => tx.wait());
  let st = await withRetry("jobState", () => contract.jobState(jobA));
  console.log(`      ${txLink(tx.hash)} → job ${STATE[Number(st[0])]}, ${formatEther(escrow)} released to the provider\n`);

  // ── Job B — provider delivers garbage → reject → client refunded ─────────
  const wantB = Buffer.from(`audited-q2-revenue ${stamp}`);
  const expB = sha256hex(wantB);
  const garbage = Buffer.from("lol 42");
  const specB = signedHash({ kind: "job-precommit", task: "audited-q2-revenue", expected_sha256: expB, committed_at: new Date().toISOString() }).hash;
  console.log("[4/5] a second job — the provider delivers garbage");
  tx = await withRetry("createJob", () => contract.createJob(me, me, specB, { value: escrow }));
  await withRetry("wait", () => tx.wait());
  const jobB = (await withRetry("jobCount", () => contract.jobCount())).toString();
  tx = await withRetry("submit", () => contract.submit(jobB, keccak256(garbage), "0x"));
  await withRetry("wait", () => tx.wait());
  console.log(`      job #${jobB} opened + submitted  ${txLink(tx.hash)}`);

  console.log("[5/5] the committed test fails → Predge calls ERC-8183 reject() → client refunded");
  const evB = evaluate(expB, garbage);
  console.log(`      verdict ${evB.verdict.toUpperCase()} · reason ${evB.reason.slice(0, 18)}…`);
  tx = await withRetry("reject", () => contract.reject(jobB, evB.reason, "0x"));
  await withRetry("wait", () => tx.wait());
  st = await withRetry("jobState", () => contract.jobState(jobB));
  console.log(`      ${txLink(tx.hash)} → job ${STATE[Number(st[0])]}, ${formatEther(escrow)} refunded to the client, provider paid nothing\n`);

  console.log("ERC-8183 job settled by an independent, committed-before-outcome, signed, bondable evaluator —");
  console.log("the seat the standard leaves to 'the client is also the evaluator'.");
  console.log(`${EXPLORER}/address/${dep.address}`);
}

const isEntry = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "demo") await cmdDemo();
  else console.log("Predge as an ERC-8183 evaluator on Arc\n\n  node job.mjs demo    createJob → submit → Predge complete/reject, live on Arc");
}
