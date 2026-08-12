// Unit tests for ExampleMarket's settlement + payout math. Run:
//   node --test market/test.mjs
//
// There is no local EVM in this project — Arc testnet is the only chain it talks
// to — so these tests ARE the safety net for the two decisions that can lose
// user funds: which mode a market settles into, and how much each staker is
// owed. They are written against market/payout.mjs, the line-for-line mirror of
// the contract, and every case below corresponds to a branch in the .sol.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Mode,
  Outcome,
  settlementMode,
  payoutOf,
  distribute,
  invariantHolds,
} from "./payout.mjs";

const GRACE = 90n * 24n * 60n * 60n;
const DEADLINE = 1_800_000_000n;
const RES_DEADLINE = DEADLINE + GRACE;

// ───────────────────────── settlement mode ─────────────────────────

test("a resolved YES with stakes on both sides pays the YES side", () => {
  assert.equal(
    settlementMode({
      resolved: true,
      outcome: Outcome.Yes,
      yesPool: 10n,
      noPool: 5n,
      now: DEADLINE,
      resolutionDeadline: RES_DEADLINE,
    }),
    Mode.PayoutYes,
  );
});

test("a resolved NO with stakes on both sides pays the NO side", () => {
  assert.equal(
    settlementMode({
      resolved: true,
      outcome: Outcome.No,
      yesPool: 10n,
      noPool: 5n,
      now: DEADLINE,
      resolutionDeadline: RES_DEADLINE,
    }),
    Mode.PayoutNo,
  );
});

test("Invalid refunds instead of confiscating — a void market has no winners", () => {
  assert.equal(
    settlementMode({
      resolved: true,
      outcome: Outcome.Invalid,
      yesPool: 10n,
      noPool: 5n,
      now: DEADLINE,
      resolutionDeadline: RES_DEADLINE,
    }),
    Mode.Refund,
  );
});

test("nobody staked the winning side -> Refund, never a payout to nobody", () => {
  // The dangerous case: outcome YES but the entire book is on NO. Paying "the
  // YES winners" would strand the whole pool (there are none) — refund instead.
  assert.equal(
    settlementMode({
      resolved: true,
      outcome: Outcome.Yes,
      yesPool: 0n,
      noPool: 500n,
      now: DEADLINE,
      resolutionDeadline: RES_DEADLINE,
    }),
    Mode.Refund,
  );
  assert.equal(
    settlementMode({
      resolved: true,
      outcome: Outcome.No,
      yesPool: 500n,
      noPool: 0n,
      now: DEADLINE,
      resolutionDeadline: RES_DEADLINE,
    }),
    Mode.Refund,
  );
});

test("an empty market settles to Refund and owes nobody anything", () => {
  const mode = settlementMode({
    resolved: true,
    outcome: Outcome.Yes,
    yesPool: 0n,
    noPool: 0n,
    now: DEADLINE,
    resolutionDeadline: RES_DEADLINE,
  });
  assert.equal(mode, Mode.Refund);
  assert.equal(distribute(mode, []).total, 0n);
});

test("unresolved before the grace window -> settle() reverts (no early void)", () => {
  for (const now of [0n, DEADLINE, RES_DEADLINE]) {
    assert.equal(
      settlementMode({
        resolved: false,
        outcome: Outcome.Unresolved,
        yesPool: 10n,
        noPool: 5n,
        now,
        resolutionDeadline: RES_DEADLINE,
      }),
      null,
      `must not void at t=${now}`,
    );
  }
});

test("a silent oracle past the grace window voids to refunds, never locks funds", () => {
  assert.equal(
    settlementMode({
      resolved: false,
      outcome: Outcome.Unresolved,
      yesPool: 10n,
      noPool: 5n,
      now: RES_DEADLINE + 1n,
      resolutionDeadline: RES_DEADLINE,
    }),
    Mode.Refund,
  );
});

test("an open market pays nothing", () => {
  assert.equal(payoutOf(Mode.Open, { yesStake: 100n, yesPool: 100n, noPool: 100n }), 0n);
});

// ───────────────────────── pro-rata payouts ────────────────────────

test("winners split the losing pool pro-rata to their stake", () => {
  // YES pool 100 (A 60, B 40), NO pool 50. YES wins.
  // A: 60 + 60*50/100 = 90 | B: 40 + 40*50/100 = 60 | sum = 150 = pool.
  const book = [
    { addr: "A", yes: 60n },
    { addr: "B", yes: 40n },
    { addr: "C", no: 50n },
  ];
  const { payouts, total, pool, dust } = distribute(Mode.PayoutYes, book);
  assert.equal(payouts.get("A"), 90n);
  assert.equal(payouts.get("B"), 60n);
  assert.equal(payouts.get("C"), 0n, "losers get nothing");
  assert.equal(total, 150n);
  assert.equal(pool, 150n);
  assert.equal(dust, 0n);
});

test("a hedged staker on both sides is paid on the winning leg only", () => {
  // A is 100 YES and 40 NO; B is 60 NO. YES wins: noPool = 100, yesPool = 100.
  // A: 100 + 100*100/100 = 200. A's own 40 NO is part of the losing pool it wins.
  const book = [
    { addr: "A", yes: 100n, no: 40n },
    { addr: "B", no: 60n },
  ];
  const { payouts, total, pool } = distribute(Mode.PayoutYes, book);
  assert.equal(payouts.get("A"), 200n);
  assert.equal(payouts.get("B"), 0n);
  assert.equal(total, pool);
});

test("one-sided market (no losers): winners get exactly their stake back", () => {
  const book = [
    { addr: "A", yes: 7n },
    { addr: "B", yes: 993n },
  ];
  const { payouts, total, pool, dust } = distribute(Mode.PayoutYes, book);
  assert.equal(payouts.get("A"), 7n);
  assert.equal(payouts.get("B"), 993n);
  assert.equal(total, pool);
  assert.equal(dust, 0n);
});

test("a winner is never paid less than their own stake", () => {
  for (const [s, w, l] of [
    [1n, 3n, 0n],
    [1n, 3n, 1n],
    [1n, 1_000_000n, 7n],
    [999n, 1000n, 1n],
  ]) {
    const p = payoutOf(Mode.PayoutYes, { yesStake: s, yesPool: w, noPool: l });
    assert.ok(p >= s, `principal lost: stake=${s} pool=${w}/${l} -> ${p}`);
  }
});

// ──────────────────────── rounding and dust ────────────────────────

test("dust: three equal winners over an indivisible losing pool", () => {
  // YES 3 (1+1+1), NO 5. Each: 1 + 1*5/3 = 1 + 1 = 2. Total 6, pool 8, dust 2.
  const book = [
    { addr: "A", yes: 1n },
    { addr: "B", yes: 1n },
    { addr: "C", yes: 1n },
    { addr: "D", no: 5n },
  ];
  const { payouts, total, pool, dust } = distribute(Mode.PayoutYes, book);
  assert.equal(payouts.get("A"), 2n);
  assert.equal(total, 6n);
  assert.equal(pool, 8n);
  assert.equal(dust, 2n);
  assert.ok(dust < 3n, "dust must stay under one wei per winner");
});

test("rounding always truncates toward the pool, never toward the claimant", () => {
  // Exact rational share is stake + stake*L/W; the contract must never exceed it.
  for (const [s, w, l] of [
    [1n, 3n, 1n],
    [2n, 7n, 5n],
    [333n, 1000n, 1n],
    [1n, 1_000_000_000n, 999_999_999n],
  ]) {
    const p = payoutOf(Mode.PayoutYes, { yesStake: s, yesPool: w, noPool: l });
    assert.ok(p * w <= s * w + s * l, `overpaid: stake=${s} W=${w} L=${l} -> ${p}`);
    // …and it must be the TIGHTEST such value (off by less than one wei).
    assert.ok((p + 1n) * w > s * w + s * l, `underpaid: stake=${s} W=${w} L=${l} -> ${p}`);
  }
});

test("dust is bounded by the number of winners", () => {
  const winners = 17;
  const book = [];
  for (let i = 0; i < winners; i++) book.push({ addr: `W${i}`, yes: 1n });
  book.push({ addr: "L", no: 100n });
  const { dust } = distribute(Mode.PayoutYes, book);
  assert.ok(dust >= 0n && dust < BigInt(winners), `dust ${dust} out of bounds`);
});

// ────────────────────────── refund mode ────────────────────────────

test("Refund returns every staker exactly their own stake, with zero dust", () => {
  const book = [
    { addr: "A", yes: 60n },
    { addr: "B", yes: 40n, no: 11n },
    { addr: "C", no: 39n },
  ];
  const { payouts, total, pool, dust } = distribute(Mode.Refund, book);
  assert.equal(payouts.get("A"), 60n);
  assert.equal(payouts.get("B"), 51n);
  assert.equal(payouts.get("C"), 39n);
  assert.equal(total, pool);
  assert.equal(dust, 0n, "refunds are exact — no division happens");
});

test("Refund after a nobody-bet-the-winner outcome makes losers whole", () => {
  // Outcome YES, entire book on NO. Everyone reclaims their stake; nothing lost.
  const book = [
    { addr: "A", no: 123n },
    { addr: "B", no: 877n },
  ];
  const mode = settlementMode({
    resolved: true,
    outcome: Outcome.Yes,
    yesPool: 0n,
    noPool: 1000n,
    now: DEADLINE,
    resolutionDeadline: RES_DEADLINE,
  });
  const { payouts, total, pool } = distribute(mode, book);
  assert.equal(payouts.get("A"), 123n);
  assert.equal(payouts.get("B"), 877n);
  assert.equal(total, pool);
});

// ─────────────────────────── the invariant ─────────────────────────

test("sum(payouts) <= pool for every hand-picked book and mode", () => {
  const books = [
    [],
    [{ addr: "A", yes: 1n }],
    [{ addr: "A", no: 1n }],
    [
      { addr: "A", yes: 1n },
      { addr: "B", no: 1n },
    ],
    [
      { addr: "A", yes: 1n },
      { addr: "B", yes: 1n },
      { addr: "C", yes: 1n },
      { addr: "D", no: 1n },
    ],
    [
      { addr: "A", yes: 10n ** 24n },
      { addr: "B", no: 1n },
    ],
    [
      { addr: "A", yes: 1n },
      { addr: "B", no: 10n ** 24n },
    ],
  ];
  for (const mode of [Mode.PayoutYes, Mode.PayoutNo, Mode.Refund, Mode.Open]) {
    for (const book of books) {
      assert.ok(invariantHolds(mode, book), `broken for mode ${mode}: ${JSON.stringify(book, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
    }
  }
});

test("fuzz: sum(payouts) <= pool over 3000 random books", () => {
  // Deterministic PRNG so any failure reproduces exactly.
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const scales = [1n, 10n ** 3n, 10n ** 12n, 10n ** 18n];

  for (let iter = 0; iter < 3000; iter++) {
    const n = 1 + Math.floor(rnd() * 8);
    const scale = scales[Math.floor(rnd() * scales.length)];
    const book = [];
    for (let i = 0; i < n; i++) {
      const e = { addr: `A${i}` };
      if (rnd() < 0.75) e.yes = BigInt(1 + Math.floor(rnd() * 1000)) * scale;
      if (rnd() < 0.75) e.no = BigInt(1 + Math.floor(rnd() * 1000)) * scale;
      book.push(e);
    }
    const yesPool = book.reduce((a, b) => a + (b.yes ?? 0n), 0n);
    const noPool = book.reduce((a, b) => a + (b.no ?? 0n), 0n);

    for (const outcome of [Outcome.Yes, Outcome.No, Outcome.Invalid]) {
      const mode = settlementMode({
        resolved: true,
        outcome,
        yesPool,
        noPool,
        now: DEADLINE,
        resolutionDeadline: RES_DEADLINE,
      });
      const { total, pool, dust } = distribute(mode, book);
      assert.ok(total <= pool, `iter ${iter}: overpaid ${total} > ${pool}`);
      assert.ok(dust >= 0n, `iter ${iter}: negative dust`);
      // Dust can only come from division, and only in a payout mode.
      if (mode === Mode.Refund) assert.equal(dust, 0n, `iter ${iter}: refund dust`);
      else assert.ok(dust < BigInt(n), `iter ${iter}: dust ${dust} >= winners ${n}`);
    }
  }
});

test("fuzz: winners never lose principal and losers never receive anything", () => {
  let seed = 12345;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let iter = 0; iter < 2000; iter++) {
    const book = [];
    const n = 2 + Math.floor(rnd() * 6);
    for (let i = 0; i < n; i++) {
      book.push({
        addr: `A${i}`,
        yes: BigInt(Math.floor(rnd() * 10 ** 6)),
        no: BigInt(Math.floor(rnd() * 10 ** 6)),
      });
    }
    const yesPool = book.reduce((a, b) => a + b.yes, 0n);
    const noPool = book.reduce((a, b) => a + b.no, 0n);
    if (yesPool === 0n || noPool === 0n) continue;

    for (const [mode, stakeKey] of [
      [Mode.PayoutYes, "yes"],
      [Mode.PayoutNo, "no"],
    ]) {
      for (const b of book) {
        const p = payoutOf(mode, { yesStake: b.yes, noStake: b.no, yesPool, noPool });
        if (b[stakeKey] === 0n) assert.equal(p, 0n, `iter ${iter}: paid a non-staker`);
        else assert.ok(p >= b[stakeKey], `iter ${iter}: principal lost`);
      }
    }
  }
});
