// Unit tests for the PredgeOracle publisher's pure logic. Run: npm run test:oracle
//
// The important one is `marketIdFor`: the CLI derives the market key in JS while
// the contract derives it in Solidity (`abi.encodePacked(platform, ":", ref)`).
// If those two ever disagree the oracle silently writes to keys no consumer
// reads — so we assert the JS derivation against ethers' faithful reimplementation
// of Solidity's packing rules, not against itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AbiCoder, keccak256, solidityPackedKeccak256, toUtf8Bytes } from "ethers";
import { marketIdFor, signedHash, ORACLE_ABI } from "../oracle.mjs";
import { verifyAttestation, ephemeralKeypair } from "../vault/attest.mjs";

test("marketIdFor matches the contract's abi.encode derivation", () => {
  for (const [platform, ref] of [
    ["polymarket", "0xabc123"],
    ["kalshi", "BTC-58K-AUG31"],
    ["polymarket", "will-it-rain?edge=1"],
    ["", ""],
  ]) {
    assert.equal(
      marketIdFor(platform, ref),
      keccak256(AbiCoder.defaultAbiCoder().encode(["string", "string"], [platform, ref])),
      `mismatch for ${platform}/${ref}`,
    );
  }
});

test("marketId is collision-safe across the platform/ref boundary", () => {
  // The reason the contract uses abi.encode and not encodePacked: with a packed
  // "<platform>:<ref>" concatenation these two DIFFERENT markets collide onto one
  // write-once slot, letting one market's outcome occupy another's.
  assert.notEqual(marketIdFor("a", "b:c"), marketIdFor("a:b", "c"));
  // …and that is exactly what the naive packed encoding would have done:
  assert.equal(
    solidityPackedKeccak256(["string", "string", "string"], ["a", ":", "b:c"]),
    solidityPackedKeccak256(["string", "string", "string"], ["a:b", ":", "c"]),
  );
});

test("different markets produce different ids; same market is stable", () => {
  assert.equal(marketIdFor("polymarket", "m1"), marketIdFor("polymarket", "m1"));
  assert.notEqual(marketIdFor("polymarket", "m1"), marketIdFor("polymarket", "m2"));
  assert.notEqual(marketIdFor("polymarket", "m1"), marketIdFor("kalshi", "m1"));
});

test("signedHash commits to the EXACT signed bytes", () => {
  const keys = ephemeralKeypair();
  const { att, hash } = signedHash({ kind: "market-resolution", outcome: "yes" }, keys);
  assert.equal(verifyAttestation(att).valid, true);
  // The on-chain hash must be keccak256 of the canonical bytes a verifier reads.
  assert.equal(hash, keccak256(toUtf8Bytes(att.canonical)));
});

test("tampering the attestation breaks both the signature and the on-chain hash", () => {
  const keys = ephemeralKeypair();
  const { att, hash } = signedHash({ kind: "market-resolution", outcome: "yes" }, keys);
  const forged = { ...att, canonical: att.canonical.replace('"yes"', '"no"') };
  assert.equal(verifyAttestation(forged).valid, false, "signature must fail");
  assert.notEqual(keccak256(toUtf8Bytes(forged.canonical)), hash, "hash must diverge");
});

test("the ABI exposes the free composable reads a settling contract needs", () => {
  const joined = ORACLE_ABI.join("\n");
  for (const fn of ["getResolution", "isResolved", "isCommitted", "outcomeOf", "commitLeadTime"]) {
    assert.match(joined, new RegExp(`function ${fn}\\b`), `${fn} missing from ABI`);
    assert.match(joined, new RegExp(`function ${fn}[^\\n]*view`), `${fn} must be a free view`);
  }
});
