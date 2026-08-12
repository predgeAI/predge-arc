// Unit tests for the V2 scoring rule (vault/score.mjs) and for the ABI shape
// PredgeSignalVaultV2 exposes. Run: node --test vault/test-v2.mjs
//
// The ABI half is not decoration: it COMPILES contracts/PredgeSignalVaultV2.sol
// with the same solc settings as the deploy scripts and asserts that the
// hand-written VAULT_V2_ABI matches the compiler's ABI selector-for-selector.
// That is what stops the keeper's ABI and the deployed contract from drifting —
// and it pins the one signature that carries the whole V2 guarantee:
//   rebalance(bytes32 marketId, bytes32 signalHash, int8 direction, string ref)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import solc from "solc";
import { Interface } from "ethers";
import {
  OUTCOME,
  SCORE,
  SCORE_NAME,
  VAULT_V2_ABI,
  decisionFromTuple,
  scoreDecision,
  tallyTrackRecord,
} from "./score.mjs";

// ───────────────────────────── scoring rule ─────────────────────────────

const LONG = 1;
const SHORT = -1;
const FLAT = 0;

test("LONG is Correct on Yes, Wrong on No", () => {
  assert.equal(scoreDecision(LONG, OUTCOME.YES), SCORE.CORRECT);
  assert.equal(scoreDecision(LONG, OUTCOME.NO), SCORE.WRONG);
});

test("SHORT is Correct on No, Wrong on Yes", () => {
  assert.equal(scoreDecision(SHORT, OUTCOME.NO), SCORE.CORRECT);
  assert.equal(scoreDecision(SHORT, OUTCOME.YES), SCORE.WRONG);
});

test("FLAT makes no claim — never Correct, never Wrong, at ANY outcome", () => {
  for (const o of [OUTCOME.UNRESOLVED, OUTCOME.YES, OUTCOME.NO, OUTCOME.INVALID]) {
    assert.equal(scoreDecision(FLAT, o), SCORE.NO_CLAIM, `FLAT scored on outcome ${o}`);
  }
});

test("an unresolved market is Pending — never a default hit", () => {
  assert.equal(scoreDecision(LONG, OUTCOME.UNRESOLVED), SCORE.PENDING);
  assert.equal(scoreDecision(SHORT, OUTCOME.UNRESOLVED), SCORE.PENDING);
  // Pending is enum 0, so a naive truthiness check would read it as "not set".
  assert.equal(SCORE.PENDING, 0);
  assert.equal(SCORE_NAME[SCORE.PENDING], "Pending");
});

test("a void (Invalid) market scores nobody", () => {
  assert.equal(scoreDecision(LONG, OUTCOME.INVALID), SCORE.NO_CLAIM);
  assert.equal(scoreDecision(SHORT, OUTCOME.INVALID), SCORE.NO_CLAIM);
});

test("the truth table is total — every (direction, outcome) pair is covered", () => {
  const seen = new Set();
  for (const d of [-1, 0, 1]) {
    for (const o of [0, 1, 2, 3]) {
      const s = scoreDecision(d, o);
      assert.ok(s in SCORE_NAME, `unmapped score ${s} for (${d},${o})`);
      seen.add(`${d}:${o}`);
    }
  }
  assert.equal(seen.size, 12);
});

test("out-of-range inputs throw rather than scoring silently", () => {
  assert.throws(() => scoreDecision(2, OUTCOME.YES), /bad direction/);
  assert.throws(() => scoreDecision(-2, OUTCOME.YES), /bad direction/);
  assert.throws(() => scoreDecision(LONG, 4), /bad outcome/);
  assert.throws(() => scoreDecision(LONG, -1), /bad outcome/);
});

// ───────────────────────────── track record ─────────────────────────────

test("tally counts each bucket separately and never blends them away", () => {
  const t = tallyTrackRecord([
    { direction: LONG, outcome: OUTCOME.YES }, // correct
    { direction: SHORT, outcome: OUTCOME.NO }, // correct
    { direction: LONG, outcome: OUTCOME.NO }, // wrong
    { direction: FLAT, outcome: OUTCOME.YES }, // no claim
    { direction: LONG, outcome: OUTCOME.INVALID }, // no claim
    { direction: SHORT, outcome: OUTCOME.UNRESOLVED }, // pending
  ]);
  assert.deepEqual(
    { correct: t.correct, wrong: t.wrong, noClaim: t.noClaim, pending: t.pending },
    { correct: 2, wrong: 1, noClaim: 2, pending: 1 },
  );
  assert.equal(t.total, 6);
  assert.equal(t.scored, 3); // only correct + wrong
  assert.equal(t.hitRate, 2 / 3);
});

test("hit rate is null (not 0, not 100%) when nothing is scoreable yet", () => {
  assert.equal(tallyTrackRecord([]).hitRate, null);
  assert.equal(tallyTrackRecord([{ direction: FLAT, outcome: OUTCOME.YES }]).hitRate, null);
  assert.equal(
    tallyTrackRecord([{ direction: LONG, outcome: OUTCOME.UNRESOLVED }]).hitRate,
    null,
  );
});

test("a record of nothing but FLAT postures has no hit rate at all", () => {
  const t = tallyTrackRecord(Array.from({ length: 20 }, () => ({ direction: FLAT, outcome: OUTCOME.YES })));
  assert.equal(t.noClaim, 20);
  assert.equal(t.scored, 0);
  assert.equal(t.hitRate, null);
});

test("decision sequence numbers are 1-based; seq 0 is rejected", () => {
  const tuple = ["0xaa", -1, "0xbb", 1723000000n];
  const d = decisionFromTuple(1, tuple);
  assert.deepEqual(d, { seq: 1, marketId: "0xaa", direction: -1, signalHash: "0xbb", timestamp: 1723000000 });
  assert.throws(() => decisionFromTuple(0, tuple), /1-based/);
});

// ─────────────────────────── ABI shape vs solc ──────────────────────────

function compileV2() {
  const path = new URL("../contracts/PredgeSignalVaultV2.sol", import.meta.url).pathname;
  const input = {
    language: "Solidity",
    sources: { "PredgeSignalVaultV2.sol": { content: readFileSync(path, "utf8") } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const fatal = (out.errors || []).filter((e) => e.severity === "error");
  assert.equal(fatal.length, 0, fatal.map((e) => e.formattedMessage).join("\n"));
  return out.contracts["PredgeSignalVaultV2.sol"]["PredgeSignalVaultV2"];
}

const compiled = compileV2();
const solcIface = new Interface(compiled.abi);
const handIface = new Interface(VAULT_V2_ABI);
const sigs = (iface, kind) => new Set(iface.fragments.filter((f) => f.type === kind).map((f) => f.format("sighash")));

test("the contract compiles clean and fits well under the EIP-170 limit", () => {
  assert.ok(compiled.evm.bytecode.object.length > 0);
  assert.ok(compiled.evm.bytecode.object.length / 2 < 24576);
});

test("hand-written VAULT_V2_ABI matches the compiler's functions exactly", () => {
  assert.deepEqual([...sigs(handIface, "function")].sort(), [...sigs(solcIface, "function")].sort());
});

test("events and custom errors match the compiler exactly", () => {
  assert.deepEqual([...sigs(handIface, "event")].sort(), [...sigs(solcIface, "event")].sort());
  assert.deepEqual([...sigs(handIface, "error")].sort(), [...sigs(solcIface, "error")].sort());
});

test("rebalance takes the marketId first — the V1 3-arg form is gone", () => {
  const f = solcIface.getFunction("rebalance");
  assert.equal(f.format("sighash"), "rebalance(bytes32,bytes32,int8,string)");
  assert.deepEqual(f.inputs.map((i) => i.name), ["marketId", "signalHash", "direction", "attestationRef"]);
  // A V1-shaped call must not accidentally resolve against V2.
  assert.equal(solcIface.fragments.some((x) => x.type === "function" && x.format("sighash") === "rebalance(bytes32,int8,string)"), false);
});

test("the pre-commit gate is reachable and its refusal is decodable", () => {
  assert.ok(solcIface.getError("MarketNotCommitted"));
  assert.ok(solcIface.getError("MarketAlreadyResolved"));
  // Keeper-side pre-flight so the gate can be checked without spending gas.
  assert.equal(solcIface.getFunction("canRebalance").format("sighash"), "canRebalance(bytes32)");
});

test("the oracle is immutable — exposed as a getter, with no setter", () => {
  assert.ok(solcIface.getFunction("oracle"));
  const setters = [...sigs(solcIface, "function")].filter((s) => /^set/i.test(s));
  assert.deepEqual(setters.sort(), ["setKeeper(address)", "setPaused(bool)"]);
});

test("the audit surface is present: decisionAt, scoreOf, trackRecord", () => {
  assert.deepEqual(solcIface.getFunction("decisionAt").outputs.map((o) => o.name), [
    "marketId", "direction", "signalHash", "timestamp",
  ]);
  assert.deepEqual(solcIface.getFunction("scoreOf").outputs.map((o) => o.name), [
    "score", "outcome", "resolved", "marketId", "direction",
  ]);
  assert.deepEqual(solcIface.getFunction("trackRecord").outputs.map((o) => o.name), [
    "correct", "wrong", "noClaim", "pending",
  ]);
  // No amend/delete path for a filed decision — the record is append-only.
  for (const s of sigs(solcIface, "function")) {
    assert.equal(/^(delete|amend|edit|remove|reset)/i.test(s), false, `mutating decision fn: ${s}`);
  }
});

test("V1 depositor guarantees survive: deposit, withdraw, pause, exposure", () => {
  const fns = sigs(solcIface, "function");
  for (const s of ["deposit()", "withdraw(uint256)", "setPaused(bool)", "balanceOf(address)", "state()"]) {
    assert.ok(fns.has(s), `missing V1 surface: ${s}`);
  }
  // withdraw is NOT gated by pause in the source (auditable by inspection).
  const src = readFileSync(new URL("../contracts/PredgeSignalVaultV2.sol", import.meta.url).pathname, "utf8");
  const withdrawSig = src.slice(src.indexOf("function withdraw("), src.indexOf("function withdraw(") + 120);
  assert.equal(/whenNotPaused/.test(withdrawSig), false, "withdraw must stay open while paused");
  assert.match(src, /event Rebalanced\(/);
  assert.match(src, /targetExposureBps/);
});

test("the Rebalanced event carries the marketId, indexed for auditors", () => {
  const ev = solcIface.getEvent("Rebalanced");
  const marketId = ev.inputs.find((i) => i.name === "marketId");
  assert.ok(marketId, "Rebalanced must carry marketId");
  assert.equal(marketId.indexed, true);
  assert.equal(ev.inputs.filter((i) => i.indexed).length, 3); // seq, marketId, signalHash
});
