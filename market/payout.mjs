// A faithful JS mirror of ExampleMarket's settlement + payout math.
//
// WHY THIS FILE EXISTS. Arc testnet is the only EVM this project can run against,
// and pushing a pool of real (test) USDC through a contract to discover a
// rounding bug is a terrible way to find one. So the two decisions that can lose
// user funds — WHICH mode a market settles into, and HOW MUCH each staker is
// owed — are mirrored here in pure functions and hammered by market/test.mjs.
// These tests are the safety net; keep this file and the contract in lockstep.
//
// All amounts are BigInt wei of native USDC (on Arc, USDC IS the native token).

/** Payout rule a settled market follows. Mirrors ExampleMarket.Mode. */
export const Mode = Object.freeze({
  Open: 0,
  PayoutYes: 1,
  PayoutNo: 2,
  Refund: 3,
});

/** Mirrors IPredgeOracle.Outcome. */
export const Outcome = Object.freeze({
  Unresolved: 0,
  Yes: 1,
  No: 2,
  Invalid: 3,
});

export const MODE_NAME = ["OPEN", "PAYOUT_YES", "PAYOUT_NO", "REFUND"];

/**
 * The mode `settle()` would freeze in, or `null` where the contract reverts
 * (`NotResolved` — the oracle has not spoken and the grace window is still open).
 *
 * Mirrors ExampleMarket.settle(). The three no-winner collapses to Refund are
 * the whole point of the function:
 *   - Invalid                : the market was void; confiscating stakes for a
 *                              non-event would be theft.
 *   - winning pool is empty  : nobody staked the winning side, so there is
 *                              literally no one to pay the losing pool to.
 *   - oracle silent past the : otherwise every staker's funds are locked in the
 *     grace window             contract forever.
 *
 * @param {{resolved: boolean, outcome: number, yesPool: bigint, noPool: bigint,
 *          now: bigint, resolutionDeadline: bigint}} s
 * @returns {number|null} a Mode, or null if `settle()` would revert
 */
export function settlementMode(s) {
  const { resolved, outcome, yesPool, noPool, now, resolutionDeadline } = s;
  if (resolved) {
    if (outcome === Outcome.Yes) return yesPool === 0n ? Mode.Refund : Mode.PayoutYes;
    if (outcome === Outcome.No) return noPool === 0n ? Mode.Refund : Mode.PayoutNo;
    return Mode.Refund; // Invalid
  }
  if (now <= resolutionDeadline) return null; // reverts NotResolved
  return Mode.Refund; // oracle stayed silent past the grace window
}

/**
 * What one account is owed. Mirrors ExampleMarket.payoutOf().
 *
 * ROUNDING: `stake + (stake * losingPool) / winningPool` with truncating
 * integer division — always in the pool's favour, never the claimant's. See
 * `invariantHolds` for the solvency consequence.
 *
 * @param {number} mode
 * @param {{yesStake: bigint, noStake: bigint, yesPool: bigint, noPool: bigint}} p
 * @returns {bigint}
 */
export function payoutOf(mode, { yesStake = 0n, noStake = 0n, yesPool = 0n, noPool = 0n }) {
  if (mode === Mode.Refund) return yesStake + noStake;
  if (mode === Mode.PayoutYes) {
    if (yesStake === 0n) return 0n;
    return yesStake + (yesStake * noPool) / yesPool;
  }
  if (mode === Mode.PayoutNo) {
    if (noStake === 0n) return 0n;
    return noStake + (noStake * yesPool) / noPool;
  }
  return 0n; // Mode.Open
}

/**
 * Payouts for a whole book, plus the dust the contract keeps.
 * @param {number} mode
 * @param {Array<{addr: string, yes?: bigint, no?: bigint}>} book
 * @returns {{payouts: Map<string, bigint>, total: bigint, pool: bigint, dust: bigint}}
 */
export function distribute(mode, book) {
  let yesPool = 0n;
  let noPool = 0n;
  for (const b of book) {
    yesPool += b.yes ?? 0n;
    noPool += b.no ?? 0n;
  }
  const payouts = new Map();
  let total = 0n;
  for (const b of book) {
    const amt = payoutOf(mode, {
      yesStake: b.yes ?? 0n,
      noStake: b.no ?? 0n,
      yesPool,
      noPool,
    });
    payouts.set(b.addr, (payouts.get(b.addr) ?? 0n) + amt);
    total += amt;
  }
  const pool = yesPool + noPool;
  return { payouts, total, pool, dust: pool - total };
}

/**
 * THE invariant: the contract can never promise more than it holds. Everything
 * else is a feature; this one is the difference between a market and a hole.
 */
export function invariantHolds(mode, book) {
  const { total, pool } = distribute(mode, book);
  return total <= pool;
}
