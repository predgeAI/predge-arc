// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev The only thing this market needs from the outside world: PredgeOracle's
///      free, permissionless views. Declared as a narrow interface (not an
///      import) so the market has no build-time coupling to the oracle source
///      and can be read top-to-bottom in one sitting.
interface IPredgeOracle {
    enum Outcome {
        Unresolved,
        Yes,
        No,
        Invalid
    }

    function getResolution(bytes32 marketId)
        external
        view
        returns (
            bool resolved,
            Outcome outcome,
            bytes32 contentHash,
            bytes32 preCommitHash,
            uint64 committedAt,
            uint64 resolvedAt
        );

    function isCommitted(bytes32 marketId) external view returns (bool);

    function isResolved(bytes32 marketId) external view returns (bool);
}

/// @title  ExampleMarket
/// @notice A minimal binary prediction market on Circle Arc that stakes native
///         USDC (`msg.value` — on Arc, USDC IS the native token, so there is no
///         ERC-20 leg) and settles SOLELY against `PredgeOracle`. It is the
///         demonstration that Arc is the SETTLEMENT layer: the money lives here,
///         the truth lives in the oracle, and nothing in between can bend one to
///         the other.
///
///         WHAT MAKES IT HONEST — three properties, each enforced by code, not
///         by promise:
///           1. BOUND TO A PRE-COMMITMENT. The constructor reverts unless
///              `oracle.isCommitted(marketId)` is already true, and reverts if
///              the market is ALREADY resolved. So this pool can only ever exist
///              on top of a call Predge published — and the chain timestamped —
///              before the outcome was knowable. You cannot spin up a market on
///              a result you already know.
///           2. NO ADMIN, ANYWHERE. There is no owner, no keeper, no pause, no
///              upgrade path, no fee, and no function that can name an outcome.
///              `settle()` is permissionless and copies whatever the oracle says.
///              The market physically cannot settle against the oracle.
///           3. NOBODY CAN BE STRANDED. Every path that has no winners — an
///              `Invalid` resolution, or a winning side nobody bet on — refunds
///              every staker their own stake rather than confiscating it. And if
///              the oracle never speaks at all, `RESOLUTION_GRACE` after the
///              betting deadline the market voids to the same refund mode, so
///              funds can never be locked in here forever.
///
/// @dev    TRUST BOUNDARY (disclosed, not hidden): this contract inherits
///         PredgeOracle's trust boundary WHOLE and adds nothing to it. The oracle
///         records keccak256 of ed25519-signed bytes that an off-chain publisher
///         verified (on-chain ed25519 is prohibitively expensive — see
///         vault/attest.mjs); what you must trust the publisher for is that those
///         bytes say what it claims. What no one has to be trusted for, because
///         the chain enforces it: that the commitment predates the resolution,
///         that the resolution was never altered, and — added here — that THIS
///         pool pays out exactly what that resolution implies. The oracle address
///         and marketId are `immutable`: they are fixed in the deploy bytecode
///         and cannot be repointed at a friendlier oracle after money arrives.
///         What that DOES leave to the staker: checking, once, before staking,
///         that `oracle()` is the real PredgeOracle deployment. A market pointed
///         at an impostor contract is a different market — the same way a token
///         pair pointed at a fake token is. Nothing here can detect that for
///         you, so it is stated plainly rather than papered over. The oracle's
///         `view` calls are this contract's only external calls; each one runs
///         before any state is written, and every path is either idempotent or
///         guarded, so even a hostile address at `oracle()` cannot re-enter its
///         way into an extra payout.
///
///         Deliberately tiny and audited-by-inspection: pull payments only (no
///         push loop that a reverting receiver could grief or that could run out
///         of gas), checks-effects-interactions plus an explicit reentrancy
///         guard, custom errors, no `receive()`/`fallback()` so stray value
///         cannot land unaccounted, and integer math whose rounding direction is
///         proven below to keep the contract solvent.
contract ExampleMarket {
    /// @notice How the pool pays out. `Open` is the zero value, so an unsettled
    ///         market can never be mistaken for a decided one.
    ///         `Refund` is the honest no-winner state: everyone reclaims exactly
    ///         their own stake, nothing is confiscated and nothing is invented.
    enum Mode {
        Open,
        PayoutYes,
        PayoutNo,
        Refund
    }

    /// @notice How long after the betting deadline the market waits for the
    ///         oracle before voiding to refunds. This is NOT an outcome override:
    ///         it is permissionless, time-based, pays every staker exactly their
    ///         own stake, and is unreachable while a resolution exists (anyone
    ///         can call `settle()` the instant the oracle speaks). It exists
    ///         because "funds locked forever because a market was never resolved"
    ///         is a worse failure than "market voided".
    uint64 public constant RESOLUTION_GRACE = 90 days;

    /// @notice The oracle this market obeys. Immutable — no repointing.
    IPredgeOracle public immutable oracle;
    /// @notice keccak256("<platform>:<market ref>") as PredgeOracle derives it
    ///         (`abi.encode`, length-prefixed and therefore collision-free).
    bytes32 public immutable marketId;
    /// @notice Last timestamp at which a stake is accepted.
    uint64 public immutable bettingDeadline;
    /// @notice `bettingDeadline + RESOLUTION_GRACE`, precomputed.
    uint64 public immutable resolutionDeadline;

    /// @notice Total native USDC staked on each side. `yesPool + noPool` is the
    ///         entire amount this contract owes; it only ever decreases after
    ///         settlement, never below what remains claimable.
    uint256 public yesPool;
    uint256 public noPool;

    mapping(address => uint256) public yesStake;
    mapping(address => uint256) public noStake;
    /// @notice One claim per address, ever — covers both sides at once because
    ///         `payoutOf` already aggregates a hedged staker's two positions.
    mapping(address => bool) public claimed;

    Mode public mode;
    /// @notice The oracle outcome this market settled on (0 while `Open`, and 0
    ///         if it voided on the grace path — see `Settled`).
    IPredgeOracle.Outcome public finalOutcome;

    uint256 private _lock;

    event BetPlaced(
        address indexed account,
        bool indexed isYes,
        uint256 amount,
        uint256 yesPool,
        uint256 noPool
    );
    event Settled(
        Mode indexed mode,
        IPredgeOracle.Outcome indexed outcome,
        uint256 yesPool,
        uint256 noPool,
        bytes32 contentHash,
        uint64 committedAt,
        uint64 resolvedAt
    );
    event Claimed(address indexed account, uint256 amount);

    error ZeroAddress();
    error NotPreCommitted();
    error AlreadyResolved();
    error BadDeadline();
    error BettingClosed();
    error ZeroStake();
    error AlreadySettled();
    error NotSettled();
    error NotResolved();
    error AlreadyClaimed();
    error NothingToClaim();
    error TransferFailed();
    error Reentrancy();

    modifier nonReentrant() {
        if (_lock == 1) revert Reentrancy();
        _lock = 1;
        _;
        _lock = 0;
    }

    /// @param oracle_ the PredgeOracle deployment this market settles against.
    /// @param marketId_ the oracle's key for this market.
    /// @param bettingDeadline_ unix seconds; stakes are refused at/after it.
    /// @dev Reverts unless the oracle already holds a PRE-COMMITMENT for
    ///      `marketId_` and has NOT yet resolved it. Together those two checks
    ///      are the whole point: the pool can only open on a call Predge made,
    ///      and timestamped on-chain, while the outcome was still unknowable.
    constructor(address oracle_, bytes32 marketId_, uint64 bettingDeadline_) {
        if (oracle_ == address(0)) revert ZeroAddress();
        if (bettingDeadline_ <= block.timestamp) revert BadDeadline();

        IPredgeOracle o = IPredgeOracle(oracle_);
        if (!o.isCommitted(marketId_)) revert NotPreCommitted();
        if (o.isResolved(marketId_)) revert AlreadyResolved();

        oracle = o;
        marketId = marketId_;
        bettingDeadline = bettingDeadline_;
        resolutionDeadline = bettingDeadline_ + RESOLUTION_GRACE;
    }

    // ─────────────────────────── betting ───────────────────────────

    /// @notice Stake native USDC on YES. On Arc, `msg.value` IS USDC.
    function betYes() external payable {
        _bet(true);
    }

    /// @notice Stake native USDC on NO.
    function betNo() external payable {
        _bet(false);
    }

    /// @dev Betting closes at the EARLIER of the deadline and the oracle's
    ///      resolution. The oracle check is not decoration: without it, anyone
    ///      watching `MarketResolved` land before the deadline could stake on the
    ///      now-known winner and take the losing pool risk-free. Closing on
    ///      resolution removes that free option entirely.
    function _bet(bool isYes) private {
        if (msg.value == 0) revert ZeroStake();
        if (block.timestamp >= bettingDeadline) revert BettingClosed();
        if (oracle.isResolved(marketId)) revert BettingClosed();

        if (isYes) {
            yesStake[msg.sender] += msg.value;
            yesPool += msg.value;
        } else {
            noStake[msg.sender] += msg.value;
            noPool += msg.value;
        }
        emit BetPlaced(msg.sender, isYes, msg.value, yesPool, noPool);
    }

    // ────────────────────────── settlement ─────────────────────────

    /// @notice Freeze the payout rule from the oracle. Permissionless, callable
    ///         exactly once, and it copies the oracle verbatim — there is no
    ///         argument to this function, because there is nothing for a caller
    ///         to decide.
    /// @dev Two no-winner cases collapse to `Refund` rather than to a payout:
    ///      an `Invalid` resolution (the market was void — confiscating stakes
    ///      because a non-event happened would be theft), and a winning side
    ///      NOBODY staked (`winningPool == 0`) — there is no one to distribute
    ///      the losing pool to, so paying it to "the winners" would either strand
    ///      it forever or hand it to whoever wrote this contract. Neither is
    ///      acceptable, so everyone simply takes their own stake home.
    function settle() external {
        if (mode != Mode.Open) revert AlreadySettled();

        (
            bool resolved,
            IPredgeOracle.Outcome outcome,
            bytes32 contentHash,
            ,
            uint64 committedAt,
            uint64 resolvedAt
        ) = oracle.getResolution(marketId);

        Mode m;
        if (resolved) {
            if (outcome == IPredgeOracle.Outcome.Yes) {
                m = yesPool == 0 ? Mode.Refund : Mode.PayoutYes;
            } else if (outcome == IPredgeOracle.Outcome.No) {
                m = noPool == 0 ? Mode.Refund : Mode.PayoutNo;
            } else {
                // Outcome.Invalid — `Unresolved` is unreachable while resolved.
                m = Mode.Refund;
            }
            finalOutcome = outcome;
        } else {
            // Not resolved: wait, unless the oracle has stayed silent past the
            // grace window, in which case the market voids to refunds.
            if (block.timestamp <= resolutionDeadline) revert NotResolved();
            m = Mode.Refund;
        }

        mode = m;
        emit Settled(m, outcome, yesPool, noPool, contentHash, committedAt, resolvedAt);
    }

    // ─────────────────────────── payouts ───────────────────────────

    /// @notice What `account` is owed once the market is settled. 0 while `Open`
    ///         and 0 after they have claimed.
    ///
    ///         ROUNDING: winners are paid `stake + (stake * losingPool) /
    ///         winningPool`, and Solidity's integer division truncates toward
    ///         zero — i.e. ALWAYS in the pool's favour, never the claimant's.
    ///         Because `sum(stake_i) == winningPool`, we get
    ///         `sum(floor(stake_i * L / W)) <= floor(sum(stake_i) * L / W) == L`,
    ///         so total payouts are at most `W + L`: the contract can never
    ///         promise more than it holds, no matter the stake distribution.
    ///         The remainder is DUST — strictly less than one wei per winner,
    ///         i.e. under `numWinners` wei of an 18-decimal token — and it stays
    ///         in the contract unclaimed. Paying it to a "last claimant" would
    ///         make payouts depend on claim ORDER; leaving it makes every payout
    ///         a pure function of the stakes. Solvency was worth more than the
    ///         dust.
    ///
    ///         In `Refund` mode an account gets back exactly `yesStake +
    ///         noStake`, so refunds sum to precisely `yesPool + noPool` with no
    ///         dust and no rounding at all.
    function payoutOf(address account) public view returns (uint256) {
        if (claimed[account]) return 0;

        Mode m = mode;
        if (m == Mode.Refund) {
            return yesStake[account] + noStake[account];
        }
        if (m == Mode.PayoutYes) {
            uint256 s = yesStake[account];
            if (s == 0) return 0;
            // yesPool > 0 is guaranteed: `settle` routes a zero winning pool to
            // Refund, and s > 0 implies yesPool >= s > 0 regardless.
            return s + (s * noPool) / yesPool;
        }
        if (m == Mode.PayoutNo) {
            uint256 s = noStake[account];
            if (s == 0) return 0;
            return s + (s * yesPool) / noPool;
        }
        return 0; // Mode.Open
    }

    /// @notice Withdraw your winnings (or your refund). PULL, never push: this
    ///         contract never iterates stakers to send funds, so no reverting
    ///         receiver can block anyone else's money and no staker count can
    ///         exhaust the gas of a settlement.
    /// @dev Checks-effects-interactions — `claimed` is set BEFORE the transfer —
    ///      belt-and-braces with `nonReentrant`. A re-entering receiver therefore
    ///      sees `claimed[msg.sender] == true` and gets `AlreadyClaimed`, even if
    ///      the guard were somehow absent.
    function claim() external nonReentrant returns (uint256 amount) {
        if (mode == Mode.Open) revert NotSettled();
        if (claimed[msg.sender]) revert AlreadyClaimed();

        amount = payoutOf(msg.sender);
        if (amount == 0) revert NothingToClaim();

        claimed[msg.sender] = true;

        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Claimed(msg.sender, amount);
    }

    // ──────────────────────────── views ────────────────────────────

    /// @notice Whole market state in one call, for a UI or a settling bot.
    function state()
        external
        view
        returns (
            Mode mode_,
            IPredgeOracle.Outcome outcome_,
            uint256 yesPool_,
            uint256 noPool_,
            uint64 bettingDeadline_,
            uint64 resolutionDeadline_,
            uint256 balance_
        )
    {
        return (
            mode,
            finalOutcome,
            yesPool,
            noPool,
            bettingDeadline,
            resolutionDeadline,
            address(this).balance
        );
    }

    /// @notice True while stakes are still accepted.
    function isOpen() external view returns (bool) {
        return block.timestamp < bettingDeadline && !oracle.isResolved(marketId);
    }
}
