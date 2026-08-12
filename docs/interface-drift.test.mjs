// The published interface must never drift from the deployed contract.
// Run: node --test docs/interface-drift.test.mjs
//
// WHY THIS EXISTS. `contracts/IPredgeOracle.sol` is the file other Arc builders
// import into their own build. It is a hand-written copy of a subset of
// `contracts/PredgeOracle.sol`, and a hand-written copy is a lie waiting to
// happen: change a return type, reorder `getResolution`'s six return values, or
// drop an `indexed` from an event, and every consumer keeps compiling while
// silently decoding garbage. A selector match alone would NOT catch a reordered
// return tuple — the selector covers arguments only — so this compares the FULL
// normalised ABI entry: argument types, return types, mutability, and indexing.
//
// There are THREE copies of this interface in the repo, and all three are
// checked here: the published one, the inline one inside ExampleMarket.sol (kept
// inline on purpose, so the market reads top-to-bottom), and the human-readable
// ORACLE_ABI the publisher CLI actually sends transactions with.
//
// Offline by design: it compiles from source with the repo's own solc — the same
// compiler and settings script/deploy-oracle.mjs used to produce the deployed
// bytecode at 0xF160AbE664C34CF4C117101b4308bb16325a1ABc — and never touches the
// network, so it cannot fail because an RPC endpoint rate-limited.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import solc from "solc";
import { Interface, id } from "ethers";
import { ORACLE_ABI } from "../oracle.mjs";

const SOURCES = ["PredgeOracle.sol", "IPredgeOracle.sol", "ExampleMarket.sol"];

const compiled = (() => {
  const sources = {};
  for (const f of SOURCES) {
    sources[f] = {
      content: readFileSync(new URL(`../contracts/${f}`, import.meta.url).pathname, "utf8"),
    };
  }
  const out = JSON.parse(
    solc.compile(
      JSON.stringify({
        language: "Solidity",
        sources,
        settings: {
          optimizer: { enabled: true, runs: 200 },
          outputSelection: { "*": { "*": ["abi"] } },
        },
      }),
    ),
  );
  const fatal = (out.errors || []).filter((e) => e.severity === "error");
  assert.equal(fatal.length, 0, "contracts must compile:\n" + fatal.map((e) => e.formattedMessage).join("\n"));
  return out.contracts;
})();

const abiOf = (file, name) => {
  const c = compiled[file]?.[name];
  assert.ok(c, `${file}:${name} not found in compiler output`);
  return c.abi;
};

/** Flatten an ABI param to its canonical type string (tuples included). */
const typeOf = (p) =>
  p.type.startsWith("tuple")
    ? `(${p.components.map(typeOf).join(",")})${p.type.slice(5)}`
    : p.type;

const sigOf = (e) => `${e.name}(${(e.inputs || []).map(typeOf).join(",")})`;

/**
 * Everything that can silently break a consumer, in one comparable string:
 * name, argument types, RETURN types (selectors do not cover these), mutability,
 * and — for events — which fields are indexed, i.e. what an indexer can filter on.
 */
const shapeOf = (e) =>
  e.type === "event"
    ? `event ${e.name}(${(e.inputs || []).map((p) => `${typeOf(p)}${p.indexed ? " indexed" : ""}`).join(",")})${e.anonymous ? " anonymous" : ""}`
    : `function ${sigOf(e)}->(${(e.outputs || []).map(typeOf).join(",")}) ${e.stateMutability}`;

const index = (abi) => {
  const m = new Map();
  for (const e of abi) if (e.type === "function" || e.type === "event") m.set(`${e.type}:${e.name}`, e);
  return m;
};

const ORACLE = index(abiOf("PredgeOracle.sol", "PredgeOracle"));
const PUBLISHED = abiOf("IPredgeOracle.sol", "IPredgeOracle");
const INLINE = abiOf("ExampleMarket.sol", "IPredgeOracle");

/** Assert every entry of `iface` exists in PredgeOracle with an identical shape. */
function assertNoDrift(iface, label) {
  const entries = iface.filter((e) => e.type === "function" || e.type === "event");
  assert.ok(entries.length > 0, `${label} declares nothing`);
  for (const e of entries) {
    const deployed = ORACLE.get(`${e.type}:${e.name}`);
    assert.ok(deployed, `${label}: ${e.type} ${e.name} does not exist on PredgeOracle`);
    assert.equal(shapeOf(e), shapeOf(deployed), `${label}: ${e.name} has drifted from the deployed contract`);
  }
  return entries;
}

test("the published interface matches the deployed contract, entry for entry", () => {
  const entries = assertNoDrift(PUBLISHED, "IPredgeOracle.sol");
  // Sanity: the file is actually carrying the surface it claims to.
  const names = new Set(entries.map((e) => e.name));
  for (const fn of [
    "getResolution",
    "isResolved",
    "outcomeOf",
    "isCommitted",
    "commitLeadTime",
    "attestationRef",
    "marketIdFor",
    "MarketCommitted",
    "MarketResolved",
  ]) {
    assert.ok(names.has(fn), `${fn} missing from the published interface`);
  }
});

test("ExampleMarket's inline interface has not drifted either", () => {
  // The worked example is documentation too: if this copy rots, the snippet
  // everyone pastes rots with it.
  assertNoDrift(INLINE, "ExampleMarket.sol (inline)");
});

test("selectors and event topics are byte-identical", () => {
  // Belt to the shape check's braces, and the thing a consumer can verify against
  // the chain by hand: `cast sig` / a topic0 in an explorer.
  for (const e of PUBLISHED) {
    if (e.type !== "function" && e.type !== "event") continue;
    const deployed = ORACLE.get(`${e.type}:${e.name}`);
    const mine = id(sigOf(e));
    const theirs = id(sigOf(deployed));
    if (e.type === "function") {
      assert.equal(mine.slice(0, 10), theirs.slice(0, 10), `selector drift on ${e.name}`);
    } else {
      assert.equal(mine, theirs, `topic0 drift on ${e.name}`);
    }
  }
});

test("every function the interface publishes is a free view", () => {
  // The promise in the docs is "reading an outcome costs a consumer nothing".
  // A non-view leaking in here would break it silently — a consumer's `settle()`
  // would go from a staticcall to a state-changing call.
  for (const e of PUBLISHED) {
    if (e.type !== "function") continue;
    assert.ok(
      e.stateMutability === "view" || e.stateMutability === "pure",
      `${e.name} is ${e.stateMutability} — the published interface must stay read-only`,
    );
  }
});

test("the interface publishes no write path", () => {
  // commitMarket / postResolution / setPublisher are Predge's operational
  // surface. A consumer that depends on them is depending on our key management
  // instead of the chain's ordering guarantee, so they must stay out.
  const names = new Set(PUBLISHED.map((e) => e.name));
  for (const w of ["commitMarket", "postResolution", "setPublisher", "owner", "publisher"]) {
    assert.equal(names.has(w), false, `${w} must not appear in the consumer interface`);
  }
});

test("the publisher CLI's ABI agrees with the published interface", () => {
  // oracle.mjs is what actually sends the transactions and reads them back. If
  // its human-readable ABI and the .sol interface disagree, one of them is
  // describing a contract that does not exist.
  const cli = new Interface(ORACLE_ABI);
  for (const e of PUBLISHED) {
    if (e.type !== "function") continue;
    const f = cli.getFunction(e.name);
    if (!f) continue; // the CLI declares a subset; absence is not drift
    assert.equal(f.selector, id(sigOf(e)).slice(0, 10), `oracle.mjs disagrees on ${e.name}`);
    // The enum lands as uint8 over the wire; compare the wire types.
    const wire = (e.outputs || []).map(typeOf).join(",");
    assert.equal(f.outputs.map((o) => o.type).join(","), wire, `oracle.mjs return types differ on ${e.name}`);
  }
});

test("Outcome's zero value is Unresolved", () => {
  // The single most load-bearing fact in the integration guide: an unknown
  // market reads as Unresolved, never as a false NO. It is a source-level
  // property, so assert it at the source.
  const src = readFileSync(new URL("../contracts/IPredgeOracle.sol", import.meta.url).pathname, "utf8");
  const body = /enum\s+Outcome\s*\{([^}]*)\}/.exec(src);
  assert.ok(body, "Outcome enum not found");
  const members = body[1]
    .split(",")
    .map((s) => s.replace(/\/\/[^\n]*/g, "").trim())
    .filter(Boolean);
  assert.deepEqual(members, ["Unresolved", "Yes", "No", "Invalid"]);
});
