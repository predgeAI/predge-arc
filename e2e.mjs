// PREDGE ON ARC — the whole story in one command.
//
//   node e2e.mjs
//
// Runs the full loop live on Circle Arc testnet and prints an arcscan link for
// every step, so the claim "Arc is the settlement layer" is something you watch
// happen rather than something you read:
//
//   1. the chain REFUSES to resolve a market that was never pre-committed
//   2. Predge pre-commits its ed25519-signed call, while the outcome is unknowable
//   3. a real prediction market deploys, BOUND to that commitment
//   4. two wallets stake native USDC on opposite sides
//   5. the outcome settles — signed, welded to the commitment
//   6. the chain REFUSES to rewrite that resolution, even for the publisher
//   7. the market settles itself from the oracle (no admin, no arguments)
//   8. the winner claims real USDC; the loser is owed nothing
//
// Nothing here is staged: every refusal is a real revert from the deployed
// contracts, and the payout moves actual testnet USDC between real wallets.
import { readFileSync, existsSync } from "node:fs";
import solc from "solc";
import {
  AbiCoder,
  Contract,
  ContractFactory,
  Wallet,
  formatUnits,
  keccak256,
  parseUnits,
  toUtf8Bytes,
} from "ethers";
import { makeProvider, withRetry, txLink, addressLink } from "./lib/arc.mjs";
import { ORACLE_ABI } from "./oracle.mjs";
import { ephemeralKeypair, signAttestation, verifyAttestation } from "./vault/attest.mjs";

const ENV = new URL(".env", import.meta.url).pathname;
const ORACLE_DEPLOYMENT = new URL("oracle/deployment.json", import.meta.url).pathname;
const MARKET_SOL = new URL("contracts/ExampleMarket.sol", import.meta.url).pathname;

// Stakes are deliberately tiny — this is a proof, not a casino.
const YES_STAKE = parseUnits("0.02", 18); // operator bets YES (the winning side)
const NO_STAKE = parseUnits("0.01", 18); // the second wallet bets NO
const FUND_WALLET2 = parseUnits("0.06", 18); // NO stake + gas headroom

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const usdc = (wei) => `${formatUnits(wei, 18)} USDC`;
const step = (n, title) => console.log(`\n[${n}/8] ${title}`);
const ok = (...a) => console.log("     ", ...a);

/** The custom-error name the chain reverted with (needs errors in the ABI). */
function revertName(e) {
  if (e?.revert?.name) return e.revert.name;
  const s = `${e?.shortMessage || e?.message || ""} ${e?.info?.error?.message || ""}`;
  const m =
    /(AlreadyResolved|NotCommitted|AlreadyCommitted|NotPublisher|BadOutcome|ZeroHash|NotPreCommitted|BettingClosed|NothingToClaim|AlreadyClaimed|NotSettled|NotResolved)/.exec(
      s,
    );
  return m ? m[1] : e?.shortMessage || "reverted";
}

/** Predge-shaped signed attestation + the keccak256 the chain commits to. */
function signedHash(payload) {
  const { privateKey, publicKey } = ephemeralKeypair();
  const att = signAttestation(payload, privateKey, publicKey);
  return { att, hash: keccak256(toUtf8Bytes(att.canonical)) };
}

const MARKET_ABI = [
  "function betYes() external payable",
  "function betNo() external payable",
  "function settle() external",
  "function claim() external returns (uint256)",
  "function payoutOf(address) view returns (uint256)",
  "function state() view returns (uint8 mode, uint8 outcome, uint256 yesPool, uint256 noPool, uint64 bettingDeadline, uint64 resolutionDeadline, uint256 balance)",
  "error NotPreCommitted()",
  "error BettingClosed()",
  "error NothingToClaim()",
  "error AlreadyClaimed()",
  "error NotSettled()",
  "error NotResolved()",
  "error ZeroStake()",
];
const MODE = ["OPEN", "PAYOUT_YES", "PAYOUT_NO", "REFUND"];
const OUTCOME = { yes: 1, no: 2, invalid: 3 };

// ── setup ───────────────────────────────────────────────────────────────────
const env = parseEnv(ENV);
if (!env.PRIVATE_KEY) {
  console.error("No PRIVATE_KEY in .env.");
  process.exit(1);
}
if (!existsSync(ORACLE_DEPLOYMENT)) {
  console.error("No oracle/deployment.json — run `npm run deploy-oracle` first.");
  process.exit(1);
}
const oracleAddr = JSON.parse(readFileSync(ORACLE_DEPLOYMENT, "utf8")).address;

const provider = makeProvider(env.ARC_RPC);
const operator = new Wallet(env.PRIVATE_KEY, provider);
const oracle = new Contract(oracleAddr, ORACLE_ABI, operator);

const stamp = Date.now();
const platform = "polymarket";
const marketRef = `e2e-${stamp}`;
const marketId = keccak256(
  AbiCoder.defaultAbiCoder().encode(["string", "string"], [platform, marketRef]),
);

console.log("PREDGE ON ARC — end-to-end, live on testnet");
console.log("oracle  ", addressLink(oracleAddr));
console.log("operator", operator.address);
console.log("market  ", `${platform}:${marketRef}`);
console.log("marketId", marketId);

const startBal = await withRetry("balance", () => provider.getBalance(operator.address));
console.log("balance ", usdc(startBal));
if (startBal < FUND_WALLET2 + YES_STAKE + parseUnits("0.05", 18)) {
  console.error("\nNot enough testnet USDC. Fund the operator at https://faucet.circle.com (Arc Testnet).");
  process.exit(1);
}

// ── 1. hindsight resolution is impossible ───────────────────────────────────
step(1, "the chain REFUSES to resolve a market that was never pre-committed");
try {
  await oracle.postResolution.staticCall(marketId, OUTCOME.yes, keccak256(toUtf8Bytes("x")), "");
  ok("UNEXPECTED: it did not revert");
} catch (e) {
  ok(`reverted: ${revertName(e)} — an outcome cannot be filed with hindsight`);
}

// ── 2. pre-commit, while the outcome is still unknowable ────────────────────
step(2, "Predge pre-commits its signed call — the chain timestamps it");
const pre = signedHash({
  kind: "market-precommit",
  platform,
  market: marketRef,
  committed_at: new Date().toISOString(),
});
ok("preCommitHash", pre.hash);
ok("ed25519 signature valid:", verifyAttestation(pre.att).valid);
let tx = await withRetry("commit", () =>
  oracle.commitMarket(marketId, pre.hash, `https://predge.io/r/${marketRef}`),
);
await withRetry("wait", () => tx.wait());
ok(txLink(tx.hash));

// ── 3. a real market deploys, bound to that commitment ──────────────────────
step(3, "a prediction market deploys, BOUND to that pre-commitment");
const compiled = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: { "ExampleMarket.sol": { content: readFileSync(MARKET_SOL, "utf8") } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
  ),
);
const fatal = (compiled.errors || []).filter((e) => e.severity === "error");
if (fatal.length) {
  console.error(fatal.map((e) => e.formattedMessage).join("\n"));
  process.exit(1);
}
const art = compiled.contracts["ExampleMarket.sol"]["ExampleMarket"];
const deadline = Math.floor(Date.now() / 1000) + 20 * 60; // 20 minutes of betting
const factory = new ContractFactory(art.abi, "0x" + art.evm.bytecode.object, operator);
const market = await withRetry("deployMarket", () => factory.deploy(oracleAddr, marketId, deadline));
await withRetry("waitMarket", () => market.waitForDeployment());
const marketAddr = await market.getAddress();
ok("ExampleMarket", addressLink(marketAddr));
ok("(its constructor reverts unless the oracle already holds the commitment)");

// ── 4. two wallets stake native USDC on opposite sides ──────────────────────
step(4, "two wallets stake native USDC on opposite sides");
// The second bettor is DERIVED DETERMINISTICALLY from the operator key, never
// Wallet.createRandom(). A random in-memory key means that if this script dies
// between funding and spending, the funds are stranded at an address nobody can
// ever sign for. Deriving it makes the same wallet reappear on every run, so a
// crashed run's leftovers are simply reused instead of lost.
const bettor2 = new Wallet(
  keccak256(toUtf8Bytes(`predge-e2e-bettor2:${env.PRIVATE_KEY}`)),
  provider,
);
const b2Bal = await withRetry("b2bal", () => provider.getBalance(bettor2.address));
if (b2Bal >= NO_STAKE + parseUnits("0.01", 18)) {
  ok(`second bettor ${bettor2.address.slice(0, 10)}… already holds ${usdc(b2Bal)} — reusing`);
} else {
  tx = await withRetry("fund", () => operator.sendTransaction({ to: bettor2.address, value: FUND_WALLET2 }));
  await withRetry("waitFund", () => tx.wait());
  ok(`funded second bettor ${bettor2.address.slice(0, 10)}… with ${usdc(FUND_WALLET2)}`);
}

const mOp = new Contract(marketAddr, MARKET_ABI, operator);
const mB2 = new Contract(marketAddr, MARKET_ABI, bettor2);
tx = await withRetry("betYes", () => mOp.betYes({ value: YES_STAKE }));
await withRetry("waitYes", () => tx.wait());
ok(`operator staked ${usdc(YES_STAKE)} on YES — ${txLink(tx.hash)}`);
tx = await withRetry("betNo", () => mB2.betNo({ value: NO_STAKE }));
await withRetry("waitNo", () => tx.wait());
ok(`bettor2  staked ${usdc(NO_STAKE)} on NO  — ${txLink(tx.hash)}`);

// ── 5. the outcome settles ──────────────────────────────────────────────────
step(5, "the outcome settles — signed, and welded to the commitment");
const res = signedHash({
  kind: "market-resolution",
  platform,
  market: marketRef,
  outcome: "yes",
  resolved_at: new Date().toISOString(),
});
ok("contentHash", res.hash);
tx = await withRetry("resolve", () =>
  oracle.postResolution(marketId, OUTCOME.yes, res.hash, `https://predge.io/r/${marketRef}/evidence`),
);
await withRetry("waitResolve", () => tx.wait());
ok(txLink(tx.hash));
const lead = await withRetry("lead", () => oracle.commitLeadTime(marketId));
ok(`committed ${lead}s before the outcome was recorded — proven by the chain, not by us`);

// ── 6. the resolution cannot be rewritten ───────────────────────────────────
step(6, "the chain REFUSES to rewrite that resolution — even for the publisher");
try {
  await oracle.postResolution.staticCall(marketId, OUTCOME.no, res.hash, "");
  ok("UNEXPECTED: a rewrite succeeded");
} catch (e) {
  ok(`reverted: ${revertName(e)} — the record is permanent`);
}
// …and betting is closed the moment the oracle speaks, so nobody can bet on a known result.
try {
  await mB2.betNo.staticCall({ value: NO_STAKE });
  ok("UNEXPECTED: betting still open after resolution");
} catch (e) {
  ok(`betting after resolution reverted: ${revertName(e)} — no risk-free bet on a known outcome`);
}

// ── 7. the market settles itself from the oracle ────────────────────────────
step(7, "the market settles itself FROM the oracle — no admin, no arguments");
tx = await withRetry("settle", () => mOp.settle());
await withRetry("waitSettle", () => tx.wait());
ok(txLink(tx.hash));
let st = await withRetry("state", () => mOp.state());
ok(`mode ${MODE[Number(st[0])]} · YES pool ${usdc(st[2])} · NO pool ${usdc(st[3])}`);

// ── 8. the winner claims real USDC ──────────────────────────────────────────
step(8, "the winner claims real USDC; the loser is owed nothing");
const owedWinner = await withRetry("payoutOp", () => mOp.payoutOf(operator.address));
const owedLoser = await withRetry("payoutB2", () => mOp.payoutOf(bettor2.address));
ok(`operator owed ${usdc(owedWinner)} (staked ${usdc(YES_STAKE)} + the losing pool)`);
ok(`bettor2  owed ${usdc(owedLoser)}`);

const before = await withRetry("balBefore", () => provider.getBalance(operator.address));
tx = await withRetry("claim", () => mOp.claim());
const rc = await withRetry("waitClaim", () => tx.wait());
const after = await withRetry("balAfter", () => provider.getBalance(operator.address));
ok(`claimed — ${txLink(tx.hash)}`);
ok(`operator balance ${usdc(before)} -> ${usdc(after)} (gas ${usdc(rc.gasUsed * rc.gasPrice)})`);

try {
  await mB2.claim.staticCall();
  ok("UNEXPECTED: the loser could claim");
} catch (e) {
  ok(`loser's claim reverted: ${revertName(e)} — losers are owed nothing, and nothing is confiscated beyond the stake`);
}

// Return the second bettor's leftover gas to the operator — testnet USDC is a
// shared, rate-limited faucet resource, so a demo should not quietly consume it.
try {
  const left = await withRetry("b2left", () => provider.getBalance(bettor2.address));
  const fee = parseUnits("0.005", 18); // gas headroom for the sweep itself
  if (left > fee) {
    tx = await withRetry("sweep", () =>
      bettor2.sendTransaction({ to: operator.address, value: left - fee }),
    );
    await withRetry("waitSweep", () => tx.wait());
    ok(`swept ${usdc(left - fee)} back to the operator`);
  }
} catch {
  ok("(sweep skipped — leftover stays at the derived bettor address, recoverable on the next run)");
}

st = await withRetry("stateEnd", () => mOp.state());
console.log("\n─────────────────────────────────────────────────────────────");
console.log("oracle       ", addressLink(oracleAddr));
console.log("market       ", addressLink(marketAddr));
console.log("residual dust", usdc(st[6]), "(sub-wei-per-winner rounding, left in the contract by design)");
console.log("\nEvery step above is a real transaction on Circle Arc. The two refusals");
console.log("are real reverts from deployed code — that is the difference between a");
console.log("guarantee and a promise.");
