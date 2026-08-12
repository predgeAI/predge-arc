// SCORE — the off-chain mirror of PredgeSignalVaultV2's scoring rule, plus the
// V2 ABI. Pure functions only: no I/O, no chain access, no randomness, so the
// whole rule is unit-testable on one screen (see vault/test-v2.mjs).
//
// V2 changes the deal for the vault: `rebalance` now carries the oracle
// `marketId` and REVERTS unless PredgeOracle already holds a public pre-commit
// for that market and has NOT yet resolved it. So every decision the vault files
// is an ex-ante call on a still-open market — which means it can be scored later,
// honestly, against an outcome that cannot be rewritten.
//
// The rule below is byte-for-byte the same as `_score` in the contract. If you
// change one, change the other; test-v2.mjs compiles the contract and re-checks
// the ABI so the two cannot silently drift.
//
//   FLAT (0)              -> NO_CLAIM   always. A flat posture asserts nothing;
//                                       it is never a hit and never a miss.
//   market not resolved   -> PENDING    (never a default hit)
//   outcome Invalid       -> NO_CLAIM   (void market scores nobody)
//   LONG + Yes / SHORT+No -> CORRECT
//   LONG + No  / SHORT+Yes-> WRONG

/** PredgeOracle.Outcome — the enum's on-chain ordinals. */
export const OUTCOME = { UNRESOLVED: 0, YES: 1, NO: 2, INVALID: 3 };
export const OUTCOME_NAME = { 0: "Unresolved", 1: "Yes", 2: "No", 3: "Invalid" };

/** PredgeSignalVaultV2.Score — the enum's on-chain ordinals. */
export const SCORE = { PENDING: 0, CORRECT: 1, WRONG: 2, NO_CLAIM: 3 };
export const SCORE_NAME = { 0: "Pending", 1: "Correct", 2: "Wrong", 3: "NoClaim" };

/**
 * Score one posture against a settled outcome. Mirrors `_score` exactly.
 * @param {number} direction -1 SHORT | 0 FLAT | +1 LONG
 * @param {number} outcome   OUTCOME.*
 * @returns {number} SCORE.*
 */
export function scoreDecision(direction, outcome) {
  const d = Number(direction);
  const o = Number(outcome);
  if (!Number.isInteger(d) || d < -1 || d > 1) throw new Error(`bad direction: ${direction}`);
  if (!Number.isInteger(o) || o < 0 || o > 3) throw new Error(`bad outcome: ${outcome}`);
  // FLAT first: a no-claim stays a no-claim whether or not the market settled.
  if (d === 0) return SCORE.NO_CLAIM;
  if (o === OUTCOME.UNRESOLVED) return SCORE.PENDING;
  if (o === OUTCOME.INVALID) return SCORE.NO_CLAIM;
  const saidYes = d > 0; // LONG == "Yes", SHORT == "No"
  const wasYes = o === OUTCOME.YES;
  return saidYes === wasYes ? SCORE.CORRECT : SCORE.WRONG;
}

/**
 * Tally a list of scored decisions the way `trackRecord` does — four separate
 * counters, never one blended "accuracy" number.
 * @param {Array<{direction:number, outcome:number}>} decisions
 * @returns {{correct:number, wrong:number, noClaim:number, pending:number,
 *            scored:number, total:number, hitRate:(number|null)}}
 *          `hitRate` is correct / (correct + wrong) and is `null` — NOT 0 —
 *          when nothing is scoreable yet, so an empty record can never be
 *          rendered as a 0% or 100% track record.
 */
export function tallyTrackRecord(decisions = []) {
  const t = { correct: 0, wrong: 0, noClaim: 0, pending: 0 };
  for (const d of decisions) {
    switch (scoreDecision(d.direction, d.outcome)) {
      case SCORE.CORRECT: t.correct++; break;
      case SCORE.WRONG: t.wrong++; break;
      case SCORE.NO_CLAIM: t.noClaim++; break;
      default: t.pending++;
    }
  }
  const scored = t.correct + t.wrong;
  return {
    ...t,
    scored,
    total: decisions.length,
    hitRate: scored === 0 ? null : t.correct / scored,
  };
}

/**
 * Normalise a `decisionAt(seq)` return tuple (ethers Result or array) into a
 * plain object. Sequence numbers are 1-BASED on-chain; seq 0 never exists.
 */
export function decisionFromTuple(seq, tuple) {
  const s = Number(seq);
  if (!Number.isInteger(s) || s < 1) throw new Error(`decision seq is 1-based, got ${seq}`);
  return {
    seq: s,
    marketId: tuple[0],
    direction: Number(tuple[1]),
    signalHash: tuple[2],
    timestamp: Number(tuple[3]),
  };
}

/** Human-readable ABI of contracts/PredgeSignalVaultV2.sol. */
export const VAULT_V2_ABI = [
  "function deposit() external payable",
  "function withdraw(uint256 amount) external",
  "function rebalance(bytes32 marketId, bytes32 signalHash, int8 direction, string attestationRef) external",
  "function setKeeper(address newKeeper) external",
  "function setPaused(bool p) external",
  "function owner() view returns (address)",
  "function keeper() view returns (address)",
  "function oracle() view returns (address)",
  "function paused() view returns (bool)",
  "function posture() view returns (int8)",
  "function rebalanceCount() view returns (uint64)",
  "function totalDeposits() view returns (uint256)",
  "function lastSignalHash() view returns (bytes32)",
  "function lastMarketId() view returns (bytes32)",
  "function lastAttestationRef() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function state() view returns (int8 posture_, uint64 rebalanceCount_, uint256 totalDeposits_, bool paused_, bytes32 lastSignalHash_, bytes32 lastMarketId_, string lastAttestationRef_)",
  "function decisionAt(uint64 seq) view returns (bytes32 marketId, int8 direction, bytes32 signalHash, uint64 timestamp)",
  "function scoreOf(uint64 seq) view returns (uint8 score, uint8 outcome, bool resolved, bytes32 marketId, int8 direction)",
  "function trackRecord(uint64 fromSeq, uint64 toSeq) view returns (uint64 correct, uint64 wrong, uint64 noClaim, uint64 pending)",
  "function canRebalance(bytes32 marketId) view returns (bool)",
  // Custom errors, so a keeper can decode WHY a rebalance was refused —
  // MarketNotCommitted means "Predge never published this call publicly".
  "error NotOwner()",
  "error NotKeeper()",
  "error IsPaused()",
  "error ZeroDeposit()",
  "error InsufficientBalance()",
  "error BadDirection()",
  "error TransferFailed()",
  "error ZeroAddress()",
  "error ZeroHash()",
  "error ZeroMarketId()",
  "error MarketNotCommitted()",
  "error MarketAlreadyResolved()",
  "error NoSuchDecision()",
  "event Deposited(address indexed account, uint256 amount, uint256 newBalance)",
  "event Withdrawn(address indexed account, uint256 amount, uint256 newBalance)",
  "event Rebalanced(uint64 indexed seq, bytes32 indexed marketId, bytes32 indexed signalHash, int8 oldPosture, int8 newPosture, uint16 targetExposureBps, string attestationRef, address keeper, uint256 timestamp)",
  "event KeeperUpdated(address indexed previousKeeper, address indexed newKeeper)",
  "event PausedSet(bool paused)",
];
