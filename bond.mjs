// Predge — capital behind a verdict, live on Arc.
//
// The validation research was blunt: a signed attestation is commodity, matching the
// receipt JSON is worth nothing, and the only axis competitors can't copy is skin in the
// game. This demo shows exactly that, trustlessly: the validator stakes a bond behind each
// verdict, and because the acceptance test is deterministic (sha256), ANYONE can slash a
// dishonest verdict on-chain — no arbiter. An honest verdict is unslashable.
//
//   Job A — honest: validator claims DELIVERED and the bytes really match → a challenge
//                    reverts (VerdictHonest); after the window the validator reclaims its bond.
//   Job B — a lie:  validator claims DELIVERED but the bytes are garbage → anyone submits
//                    the garbage, the contract recomputes sha256, and the bond is SLASHED.
//
// Run: node bond.mjs demo    (live on Arc testnet)
import crypto from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { Contract, Wallet, keccak256, toUtf8Bytes, parseEther, formatEther } from "ethers";
import { makeProvider, withRetry, txLink, addressLink, EXPLORER } from "./lib/arc.mjs";

const ENV = new URL(".env", import.meta.url).pathname;
const DEPLOYMENT = new URL("oracle/bond-deployment.json", import.meta.url).pathname;

const BOND_ABI = [
  "function stakeAndCommit(bytes32 requestHash, bytes32 expected) external payable",
  "function recordScore(bytes32 requestHash, uint8 score) external",
  "function challenge(bytes32 requestHash, bytes deliverable) external",
  "function reclaim(bytes32 requestHash) external",
  "function wouldSlash(bytes32 requestHash, bytes deliverable) view returns (bool)",
  "function slashCount() view returns (uint64)",
  "function totalBonded() view returns (uint96)",
  "function disputeWindow() view returns (uint64)",
  "event Slashed(bytes32 indexed requestHash, address indexed challenger, uint96 bond, uint8 recordedScore, bytes32 deliveredHash)",
  "error NotValidator()","error ZeroHash()","error ZeroBond()","error AlreadyCommitted()","error NotCommitted()",
  "error AlreadyScored()","error NotScored()","error Closed()","error BadScore()","error VerdictHonest()","error WindowOpen()","error TransferFailed()",
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
    console.error("No oracle/bond-deployment.json — run `node script/deploy-bond.mjs` first.");
    process.exit(1);
  }
  const dep = JSON.parse(readFileSync(DEPLOYMENT, "utf8"));
  const provider = makeProvider(env.ARC_RPC);
  const wallet = new Wallet(env.ORACLE_PUBLISHER_KEY || env.PRIVATE_KEY, provider);
  return { provider, wallet, dep, contract: new Contract(dep.address, BOND_ABI, wallet) };
}

const sha256hex = (bytes) => "0x" + crypto.createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function revertName(e) {
  if (e?.revert?.name) return e.revert.name;
  const s = (e?.shortMessage || e?.message || "") + " " + (e?.info?.error?.message || "");
  const m = /(VerdictHonest|NotScored|NotCommitted|AlreadyScored|Closed|WindowOpen|BadScore|ZeroBond)/.exec(s);
  return m ? m[1] : (e?.shortMessage || "reverted");
}

async function cmdDemo() {
  const { provider, wallet, dep, contract } = connect();
  const window = await withRetry("disputeWindow", () => contract.disputeWindow());
  const bond = parseEther("0.001");
  const stamp = Date.now();
  console.log(`Predge — capital behind a verdict · ${addressLink(dep.address)}  (disputeWindow ${window}s)\n`);

  // ── Job A — honest verdict, unslashable ──────────────────────────────────
  const reqA = keccak256(toUtf8Bytes(`bond-A-${stamp}`));
  const wantA = Buffer.from("extract-large-trades -> 4213 rows");
  const expA = sha256hex(wantA);
  console.log("[1/5] validator STAKES a bond and commits the deterministic test (Job A, honest)");
  let tx = await withRetry("stakeAndCommit", () => contract.stakeAndCommit(reqA, expA, { value: bond }));
  await withRetry("wait", () => tx.wait());
  console.log(`      staked ${formatEther(bond)} + committed expected  ${txLink(tx.hash)}`);
  tx = await withRetry("recordScore", () => contract.recordScore(reqA, 100));
  await withRetry("wait", () => tx.wait());
  console.log("      recorded verdict DELIVERED (score 100) — the claim the bond backs\n");

  console.log("[2/5] the verdict is HONEST (bytes really match) → a challenge cannot take the bond");
  console.log("      wouldSlash(correct bytes):", await withRetry("wouldSlash", () => contract.wouldSlash(reqA, wantA)));
  try {
    await contract.challenge.staticCall(reqA, wantA);
    console.log("      UNEXPECTED: challenge did not revert");
  } catch (e) {
    console.log("      challenge reverts:", revertName(e), "— you cannot grief an honest validator\n");
  }

  console.log("[3/5] after the dispute window with no successful challenge, the validator reclaims");
  await sleep(Number(window) * 1000 + 1500);
  tx = await withRetry("reclaim", () => contract.reclaim(reqA));
  await withRetry("wait", () => tx.wait());
  console.log(`      reclaimed ${formatEther(bond)}  ${txLink(tx.hash)}\n`);

  // ── Job B — a lie, slashed on-chain ──────────────────────────────────────
  const reqB = keccak256(toUtf8Bytes(`bond-B-${stamp}`));
  const wantB = Buffer.from("audited Q2 revenue: 1,284,300 USDC");
  const expB = sha256hex(wantB);
  const garbage = Buffer.from("lol here is a random number 42");
  console.log("[4/5] validator stakes, but LIES: claims DELIVERED while the real bytes are garbage (Job B)");
  tx = await withRetry("stakeAndCommit", () => contract.stakeAndCommit(reqB, expB, { value: bond }));
  await withRetry("wait", () => tx.wait());
  tx = await withRetry("recordScore", () => contract.recordScore(reqB, 100));
  await withRetry("wait", () => tx.wait());
  console.log(`      staked ${formatEther(bond)}, recorded DELIVERED (the lie)  ${txLink(tx.hash)}`);
  console.log("      wouldSlash(the garbage actually delivered):", await withRetry("wouldSlash", () => contract.wouldSlash(reqB, garbage)));

  console.log("\n[5/5] anyone submits the garbage → contract recomputes sha256 → BOND SLASHED to the challenger");
  const totalBefore = await withRetry("totalBonded", () => contract.totalBonded());
  tx = await withRetry("challenge", () => contract.challenge(reqB, garbage));
  const rc = await withRetry("wait", () => tx.wait());
  const totalAfter = await withRetry("totalBonded", () => contract.totalBonded());
  console.log("      slash tx     ", txLink(tx.hash));
  console.log(`      bonded at risk ${formatEther(totalBefore)} → ${formatEther(totalAfter)} (the lie cost the validator its stake)`);
  const slashes = await withRetry("slashCount", () => contract.slashCount());
  console.log(`      total slashes on this contract: ${slashes}`);
  console.log("      (demo: one operator plays validator+challenger; in production the challenger is anyone)\n");

  console.log("the receipt crowd signs the same JSON we do. none of them lose money for lying. that's the moat.");
  console.log(`${EXPLORER}/address/${dep.address}`);
}

const isEntry = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  const [cmd] = process.argv.slice(2);
  if (cmd === "demo") await cmdDemo();
  else console.log("Predge — capital behind a verdict on Arc\n\n  node bond.mjs demo    stake → honest survives → lie slashed, live on Arc");
}
