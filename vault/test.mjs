// Unit tests for the vault's pure logic: the ed25519 attestation verifier and
// the posture decision rule. Run: npm run test:vault  (node --test).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson,
  ephemeralKeypair,
  pinAgainstRegistry,
  signAttestation,
  verifyAndPin,
  verifyAttestation,
} from "./attest.mjs";
import { decide, POSTURE } from "./decide.mjs";
import { SAMPLE_CONSENSUS } from "./samples.mjs";

const cfg = { flowMinUsd: 5000, minSmartWallets: 3, watchMarket: "top" };

test("canonicalJson sorts keys at every level, no whitespace", () => {
  assert.equal(canonicalJson({ b: 1, a: [3, { y: 2, x: 1 }] }), '{"a":[3,{"x":1,"y":2}],"b":1}');
});

test("a valid self-signed attestation verifies", () => {
  const { privateKey, publicKey } = ephemeralKeypair();
  const att = signAttestation({ hello: "world", n: 42 }, privateKey, publicKey);
  assert.equal(verifyAttestation(att).valid, true);
});

test("tampering the canonical bytes fails verification", () => {
  const { privateKey, publicKey } = ephemeralKeypair();
  const att = signAttestation({ ok: true }, privateKey, publicKey);
  att.canonical = att.canonical.replace("true", "false");
  assert.equal(verifyAttestation(att).valid, false);
});

test("a signature from another key fails verification", () => {
  const a = ephemeralKeypair();
  const b = ephemeralKeypair();
  const att = signAttestation({ v: 1 }, a.privateKey, a.publicKey);
  att.public_key = signAttestation({ v: 1 }, b.privateKey, b.publicKey).public_key; // swap key
  assert.equal(verifyAttestation(att).valid, false);
});

test("key pinning requires an active registry key", () => {
  const { privateKey, publicKey } = ephemeralKeypair();
  const att = signAttestation({ v: 1 }, privateKey, publicKey);
  const good = { keys: [{ kid: "k1", public_key: att.public_key, active: true }] };
  const bad = { keys: [{ kid: "k1", public_key: att.public_key, active: false }] };
  assert.equal(pinAgainstRegistry(att, good).pinned, true);
  assert.equal(pinAgainstRegistry(att, bad).pinned, false);
  assert.equal(verifyAndPin(att, good).ok, true);
});

test("decide: strong YES flow -> LONG", () => {
  const d = decide(SAMPLE_CONSENSUS.riskon, POSTURE.FLAT, cfg);
  assert.equal(d.target, POSTURE.LONG);
  assert.equal(d.action, "REBALANCE");
});

test("decide: strong NO flow -> SHORT", () => {
  const d = decide(SAMPLE_CONSENSUS.riskoff, POSTURE.FLAT, cfg);
  assert.equal(d.target, POSTURE.SHORT);
});

test("decide: split/weak flow -> FLAT", () => {
  const d = decide(SAMPLE_CONSENSUS.neutral, POSTURE.FLAT, cfg);
  assert.equal(d.target, POSTURE.FLAT);
  assert.equal(d.action, "HOLD");
});

test("decide: too few smart wallets -> FLAT even with big flow", () => {
  const consensus = { markets: [{ condition_id: "0x1", direction: "yes", net_flow_usd: 99999, smart_wallets: 1 }] };
  assert.equal(decide(consensus, POSTURE.FLAT, cfg).target, POSTURE.FLAT);
});

test("decide: already LONG and still YES -> HOLD (no needless tx)", () => {
  const d = decide(SAMPLE_CONSENSUS.riskon, POSTURE.LONG, cfg);
  assert.equal(d.action, "HOLD");
});
