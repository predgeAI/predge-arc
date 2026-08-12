// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The subset of PredgeOracle (deployed on Arc testnet at
///         0xF160AbE664C34CF4C117101b4308bb16325a1ABc) this vault consumes. All
///         three are free views — the vault never pays the oracle and the oracle
///         never learns about, or can block, the vault.
interface IPredgeOracle {
    enum Outcome {
        Unresolved,
        Yes,
        No,
        Invalid
    }

    /// @notice True once Predge published a pre-outcome commitment for a market.
    function isCommitted(bytes32 marketId) external view returns (bool);

    /// @notice True once a settled outcome is permanently recorded.
    function isResolved(bytes32 marketId) external view returns (bool);

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
}

/// @title  PredgeSignalVaultV2
/// @notice PredgeSignalVault, upgraded so the vault's posture can only move on a
///         signal that was PUBLICLY PRE-COMMITTED on-chain. Everything V1 did is
///         unchanged: native-USDC deposits on Arc (`msg.value` IS USDC),
///         always-open withdrawals, owner/keeper roles, pause, exposure bps, and
///         a full event history of every decision.
///
///         WHAT V2 ADDS — a pre-commit gate and a scorable record:
///           1. `rebalance` now takes a `marketId` and REVERTS unless
///              `oracle.isCommitted(marketId)` is true. Predge must have
///              published the keccak256 of its ed25519-signed call, and the
///              CHAIN must have timestamped it, BEFORE the vault may act on it.
///              A signal kept secret is a signal this vault cannot trade.
///           2. `rebalance` also reverts once `oracle.isResolved(marketId)` is
///              true. A resolution is a SETTLED PAST outcome; a posture is a
///              FORWARD position. The vault deliberately never reads the outcome
///              to pick a side — that would be trading with hindsight, and it
///              would silently inflate the track record below. Every recorded
///              decision is therefore an ex-ante call on a still-open market.
///           3. Each rebalance is stored as a `Decision` (marketId, direction,
///              signalHash, timestamp) under a 1-based sequence number, so after
///              the oracle resolves that market ANYONE can score the decision
///              with `scoreOf` / `trackRecord` — an on-chain, append-only,
///              non-retractable track record. The vault cannot delete, amend or
///              re-file a decision; there is no such function.
///
/// @dev    TRUST BOUNDARY (disclosed, not hidden). Verifying an ed25519
///         signature on-chain is prohibitively expensive, so the authorized
///         KEEPER still verifies the Predge attestation OFF-chain (node:crypto —
///         see vault/attest.mjs) and this contract records `signalHash`, the
///         keccak256 of the exact signed bytes (`canonical`), plus
///         `attestationRef`.
///
///         WHAT THE ON-CHAIN PRE-COMMIT GATE REMOVES from the V1 trust
///         assumption: in V1 the keeper could have rebalanced on a signal that
///         was never published — invented after the fact, or held back and used
///         privately. V2 makes that impossible, because the chain refuses the
///         trade unless a commitment for that market already exists and is not
///         yet resolved. So these are now enforced, not promised:
///           • the signal's market was publicly committed BEFORE the trade
///             (`Decision.timestamp` > `Market.committedAt`, both chain-stamped);
///           • the trade happened BEFORE the outcome was recorded
///             (`Decision.timestamp` < `Market.resolvedAt`), so no posture in
///             this vault can have been taken with knowledge of the result;
///           • every posture is permanently attributable to one market and one
///             signal hash, and is scored by an oracle record that itself cannot
///             be rewritten.
///
///         WHAT STILL REQUIRES TRUSTING THE KEEPER: that the bytes it hashed
///         into `signalHash` are the Predge attestation it claims (the chain
///         checks the commitment exists, not that this hash equals that
///         commitment's `preCommitHash` — the vault acts on a signal about the
///         market, which is not byte-identical to the oracle's committed call),
///         that the attestation verified against Predge's key registry, and that
///         `direction` faithfully reflects it. That trust stays externally
///         checkable for free: the signed bytes are independently verifiable
///         against /.well-known/predge-keys.json, and `signalHash` pins exactly
///         which bytes the keeper acted on. The owner can pause deposits and
///         rebalances but can never touch depositor withdrawals, and cannot
///         alter or remove a recorded decision. No upgradeability, no proxy.
contract PredgeSignalVaultV2 {
    /// @notice How a past decision reads once its market has settled.
    ///         `NoClaim` is the honest bucket: a FLAT posture asserts nothing,
    ///         so it is NEVER counted as right or wrong, and a market the oracle
    ///         settled as `Invalid` (void / non-event) scores nobody.
    enum Score {
        Pending,
        Correct,
        Wrong,
        NoClaim
    }

    /// @notice One posture decision, exactly as it was taken. Append-only.
    struct Decision {
        bytes32 marketId; // the oracle market that was pre-committed
        bytes32 signalHash; // keccak256 of the exact signed attestation bytes
        uint64 timestamp; // chain time of the decision
        int8 direction; // -1 SHORT, 0 FLAT, +1 LONG
    }

    // -1 SHORT, 0 FLAT, +1 LONG. Stored as int8; only these three are valid.
    int8 public posture;
    uint64 public rebalanceCount;
    uint256 public totalDeposits;

    address public owner;
    address public keeper;
    bool public paused;

    /// @notice The commitment registry this vault refuses to trade without.
    ///         Immutable: the pre-commit gate cannot be swapped out for a
    ///         friendlier oracle after depositors have funded the vault.
    IPredgeOracle public immutable oracle;

    // Last signal that moved the vault — an auditable pointer to off-chain proof.
    bytes32 public lastSignalHash;
    bytes32 public lastMarketId;
    string public lastAttestationRef;

    mapping(address => uint256) public balanceOf;

    /// @dev seq => Decision. Sequence numbers are 1-BASED and match the `seq`
    ///      emitted by `Rebalanced`, so seq 0 is never a decision.
    mapping(uint64 => Decision) private _decisions;

    event Deposited(address indexed account, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed account, uint256 amount, uint256 newBalance);
    event Rebalanced(
        uint64 indexed seq,
        bytes32 indexed marketId,
        bytes32 indexed signalHash,
        int8 oldPosture,
        int8 newPosture,
        uint16 targetExposureBps,
        string attestationRef,
        address keeper,
        uint256 timestamp
    );
    event KeeperUpdated(address indexed previousKeeper, address indexed newKeeper);
    event PausedSet(bool paused);

    error NotOwner();
    error NotKeeper();
    error IsPaused();
    error ZeroDeposit();
    error InsufficientBalance();
    error BadDirection();
    error TransferFailed();
    error ZeroAddress();
    error ZeroHash();
    error ZeroMarketId();
    /// @dev The signal was never publicly pre-committed on the oracle.
    error MarketNotCommitted();
    /// @dev The outcome is already settled — a posture here would be hindsight.
    error MarketAlreadyResolved();
    error NoSuchDecision();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        _;
    }
    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    /// @param keeper_ the address allowed to call `rebalance` — the off-chain
    ///        agent that verifies Predge attestations. Rotatable via `setKeeper`.
    /// @param oracle_ the PredgeOracle commitment registry. IMMUTABLE, and
    ///        rejected if zero: a vault whose pre-commit gate could be pointed
    ///        at address(0) would have `isCommitted` calls revert (no code) and,
    ///        if it were pointed at an owner-controlled contract instead, the
    ///        whole guarantee would collapse back to "trust the operator".
    constructor(address keeper_, address oracle_) {
        if (keeper_ == address(0) || oracle_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        keeper = keeper_;
        oracle = IPredgeOracle(oracle_);
        posture = 0; // FLAT until the first pre-committed signal
    }

    // ─────────────────────────── depositor path ───────────────────────────

    /// @notice Deposit native USDC into the vault. On Arc, `msg.value` IS USDC.
    function deposit() external payable whenNotPaused {
        if (msg.value == 0) revert ZeroDeposit();
        balanceOf[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposited(msg.sender, msg.value, balanceOf[msg.sender]);
    }

    /// @notice Withdraw your own deposited USDC. Always available — even while
    ///         paused — so a pause can never trap depositor funds.
    function withdraw(uint256 amount) external {
        uint256 bal = balanceOf[msg.sender];
        if (amount == 0 || amount > bal) revert InsufficientBalance();
        balanceOf[msg.sender] = bal - amount;
        totalDeposits -= amount;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit Withdrawn(msg.sender, amount, balanceOf[msg.sender]);
    }

    // ─────────────────────────── keeper path ──────────────────────────────

    /// @notice Steer the vault's posture from a verified Predge signal about a
    ///         market that is PUBLICLY PRE-COMMITTED on the oracle and NOT YET
    ///         resolved. The vault does not read the outcome — it takes a
    ///         forward position and files it to be scored later.
    /// @param marketId   the oracle market this posture is a call ON. Must
    ///        already be committed (`oracle.isCommitted`) and still open
    ///        (`!oracle.isResolved`), or this call reverts.
    /// @param signalHash keccak256 of the exact signed attestation bytes
    ///        (`canonical`) — commits on-chain to what the keeper acted on.
    /// @param direction  -1 SHORT, 0 FLAT, +1 LONG (net smart-money direction).
    /// @param attestationRef human/machine-readable pointer to the off-chain
    ///        proof (scheme, key id, signature prefix, verify URL).
    function rebalance(
        bytes32 marketId,
        bytes32 signalHash,
        int8 direction,
        string calldata attestationRef
    ) external onlyKeeper whenNotPaused {
        if (direction < -1 || direction > 1) revert BadDirection();
        if (marketId == bytes32(0)) revert ZeroMarketId();
        if (signalHash == bytes32(0)) revert ZeroHash();
        // THE GATE. Reads only the commitment flags, never the outcome.
        if (!oracle.isCommitted(marketId)) revert MarketNotCommitted();
        if (oracle.isResolved(marketId)) revert MarketAlreadyResolved();

        int8 old = posture;
        posture = direction;
        lastSignalHash = signalHash;
        lastMarketId = marketId;
        lastAttestationRef = attestationRef;
        rebalanceCount += 1;

        _decisions[rebalanceCount] = Decision({
            marketId: marketId,
            signalHash: signalHash,
            timestamp: uint64(block.timestamp),
            direction: direction
        });

        emit Rebalanced(
            rebalanceCount,
            marketId,
            signalHash,
            old,
            direction,
            _exposureBps(direction),
            attestationRef,
            msg.sender,
            block.timestamp
        );
    }

    // ─────────────────────────── owner path ───────────────────────────────

    /// @notice Rotate the keeper (e.g. after a key rotation on the agent side).
    ///         Cannot rewrite any recorded decision. The oracle is immutable and
    ///         has no rotation path at all.
    function setKeeper(address newKeeper) external onlyOwner {
        if (newKeeper == address(0)) revert ZeroAddress();
        emit KeeperUpdated(keeper, newKeeper);
        keeper = newKeeper;
    }

    /// @notice Pause deposits + rebalances (withdrawals stay open).
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    // ─────────────────────────── read path ────────────────────────────────

    /// @notice Target allocation to the synthetic exposure bucket, in basis
    ///         points, implied by a posture (LONG/SHORT = full conviction,
    ///         FLAT = flat). Recorded for auditors; the vault holds a single
    ///         native-USDC pool because Arc testnet has no external venue to
    ///         route to — the honest scope of a thin-chain demo.
    function _exposureBps(int8 direction) internal pure returns (uint16) {
        if (direction == 0) return 0;
        return 10000;
    }

    /// @notice Read the whole vault state in one call.
    function state()
        external
        view
        returns (
            int8 posture_,
            uint64 rebalanceCount_,
            uint256 totalDeposits_,
            bool paused_,
            bytes32 lastSignalHash_,
            bytes32 lastMarketId_,
            string memory lastAttestationRef_
        )
    {
        return (
            posture,
            rebalanceCount,
            totalDeposits,
            paused,
            lastSignalHash,
            lastMarketId,
            lastAttestationRef
        );
    }

    /// @notice One past decision, exactly as filed. `seq` is 1-based and equals
    ///         the `seq` in the matching `Rebalanced` event; seq 0 and any seq
    ///         above `rebalanceCount` revert rather than returning a zeroed
    ///         struct that an auditor could mistake for a real FLAT call.
    function decisionAt(uint64 seq)
        external
        view
        returns (bytes32 marketId, int8 direction, bytes32 signalHash, uint64 timestamp)
    {
        Decision storage d = _decisionOrRevert(seq);
        return (d.marketId, d.direction, d.signalHash, d.timestamp);
    }

    /// @notice Score one past decision against the oracle's settled outcome.
    ///         Read-only and honest by construction:
    ///           • FLAT  -> `NoClaim`, always. A flat posture claims nothing, so
    ///             it can never be counted as a hit OR as a miss — not before
    ///             resolution and not after it.
    ///           • market not yet resolved -> `Pending` (never a default hit).
    ///           • outcome `Invalid` (void market) -> `NoClaim`.
    ///           • LONG + Yes, SHORT + No -> `Correct`.
    ///           • LONG + No,  SHORT + Yes -> `Wrong`.
    /// @return score     the verdict above
    /// @return outcome   the oracle's settled outcome (Unresolved while pending)
    /// @return resolved  whether the oracle has settled this market
    /// @return marketId  the market this decision was a call on
    /// @return direction the posture that was taken
    function scoreOf(uint64 seq)
        external
        view
        returns (
            Score score,
            IPredgeOracle.Outcome outcome,
            bool resolved,
            bytes32 marketId,
            int8 direction
        )
    {
        Decision storage d = _decisionOrRevert(seq);
        (bool resolved_, IPredgeOracle.Outcome outcome_, , , , ) = oracle.getResolution(d.marketId);
        return (_score(d.direction, outcome_), outcome_, resolved_, d.marketId, d.direction);
    }

    /// @notice The vault's on-chain track record over an INCLUSIVE 1-based seq
    ///         range. Reported as four separate counters and never as a single
    ///         "accuracy" number: `noClaim` (FLAT postures and void markets) and
    ///         `pending` (not settled yet) are shown, not folded away, so a
    ///         reader can compute a hit rate over `correct + wrong` only and see
    ///         exactly how much was excluded. Intended for free `eth_call`; the
    ///         range is bounded so it can never be an unbounded on-chain loop.
    function trackRecord(uint64 fromSeq, uint64 toSeq)
        external
        view
        returns (uint64 correct, uint64 wrong, uint64 noClaim, uint64 pending)
    {
        if (fromSeq == 0 || toSeq < fromSeq || toSeq > rebalanceCount) revert NoSuchDecision();
        for (uint64 s = fromSeq; s <= toSeq; s++) {
            Decision storage d = _decisions[s];
            (, IPredgeOracle.Outcome outcome_, , , , ) = oracle.getResolution(d.marketId);
            Score sc = _score(d.direction, outcome_);
            if (sc == Score.Correct) correct++;
            else if (sc == Score.Wrong) wrong++;
            else if (sc == Score.NoClaim) noClaim++;
            else pending++;
        }
    }

    /// @notice Cheap pre-flight for the keeper: would `rebalance` pass the gate
    ///         for this market right now? Saves a wasted tx, and lets anyone
    ///         check the gate is real without spending gas.
    function canRebalance(bytes32 marketId) external view returns (bool) {
        if (marketId == bytes32(0)) return false;
        return oracle.isCommitted(marketId) && !oracle.isResolved(marketId);
    }

    function _decisionOrRevert(uint64 seq) internal view returns (Decision storage d) {
        if (seq == 0 || seq > rebalanceCount) revert NoSuchDecision();
        return _decisions[seq];
    }

    /// @dev The scoring rule, in one place, pure, and mirrored byte-for-byte by
    ///      vault/score.mjs so off-chain tooling can never drift from the chain.
    ///      FLAT is checked FIRST: a no-claim stays a no-claim whether or not
    ///      the market has settled.
    function _score(int8 direction, IPredgeOracle.Outcome outcome) internal pure returns (Score) {
        if (direction == 0) return Score.NoClaim;
        if (outcome == IPredgeOracle.Outcome.Unresolved) return Score.Pending;
        if (outcome == IPredgeOracle.Outcome.Invalid) return Score.NoClaim;
        bool saidYes = direction > 0; // LONG == "Yes", SHORT == "No"
        bool wasYes = outcome == IPredgeOracle.Outcome.Yes;
        return saidYes == wasYes ? Score.Correct : Score.Wrong;
    }
}
