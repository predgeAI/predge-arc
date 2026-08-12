// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  PredgeOracle
/// @notice An on-chain OUTCOME-RESOLUTION registry for prediction markets on
///         Circle Arc. Circle's Arc blueprint gives prediction markets USDC gas,
///         FX and compliance, but leaves open *which oracle supplies outcome data
///         and how outcomes are verified*. This contract is that missing layer:
///         prediction-market and DeFi contracts call `getResolution` /
///         `isResolved` (free views) to settle in native USDC against an outcome
///         that provably could not have been edited after the fact.
///
///         THE GUARANTEE — commit, then resolve:
///           1. BEFORE an outcome is knowable, Predge publishes `commitMarket`
///              with `preCommitHash` = keccak256 of the exact ed25519-signed call
///              bytes. The CHAIN timestamps that commitment.
///           2. AFTER the market settles, `postResolution` records the outcome —
///              and REVERTS unless that market was committed first.
///           3. A resolution is written EXACTLY ONCE and can never be changed,
///              by anyone, including the owner. There is no edit path, no
///              upgrade, no admin override.
///
///         So a resolution is always bound to a commitment that the chain proves
///         predates it. This is the property token-vote oracles lack: there, a
///         vote can rewrite "truth" after the money is known (see the disputed
///         resolutions that have paid out against the documented facts). Here,
///         rewriting is not a governance decision — it is impossible.
///
/// @dev    TRUST BOUNDARY (disclosed, not hidden): verifying an ed25519 signature
///         on-chain is prohibitively expensive, so the authorized PUBLISHER
///         verifies Predge's signed attestation OFF-chain (node:crypto — see
///         vault/attest.mjs) and this contract commits to `preCommitHash` /
///         `contentHash`, the keccak256 of the exact signed bytes. What you must
///         trust the publisher for: that the bytes it hashed say what it claims.
///         What you do NOT have to trust anyone for, because the chain enforces
///         it: that the commitment predates the resolution, and that the
///         resolution was never altered afterwards. Both signed payloads stay
///         independently verifiable for free, offline, against Predge's published
///         key registry (/.well-known/predge-keys.json) — the on-chain hashes are
///         what make "the bytes I verify are the bytes it settled on" checkable.
///         Deliberately tiny and audited-by-inspection: no upgradeability, no
///         proxy, no pause on reads, no way to delete history.
contract PredgeOracle {
    /// @notice Settlement state of a market. `Unresolved` is the zero value, so
    ///         an unknown market reads as unresolved rather than as a false YES.
    ///         `Invalid` records a market that settled as void/non-events —
    ///         recorded honestly rather than forced into YES/NO.
    enum Outcome {
        Unresolved,
        Yes,
        No,
        Invalid
    }

    struct Market {
        bytes32 preCommitHash; // keccak256 of the signed pre-outcome call bytes
        bytes32 contentHash; // keccak256 of the signed resolution bytes
        uint64 committedAt; // chain time of the pre-outcome commitment
        uint64 resolvedAt; // chain time the outcome was recorded
        Outcome outcome; // Unresolved until settled; then permanent
    }

    address public owner;
    /// @notice The only address allowed to commit and resolve. Rotatable by the
    ///         owner (key rotation), but rotation can never rewrite past records.
    address public publisher;

    uint64 public commitCount;
    uint64 public resolutionCount;

    /// @dev marketId = keccak256(platform + ":" + market identifier),
    ///      e.g. keccak256("polymarket:0x1234…") — platform-agnostic by design.
    mapping(bytes32 => Market) private _markets;
    /// @dev Pointer to the off-chain proof (Evidence Pack / verify URL) per market.
    mapping(bytes32 => string) public attestationRef;

    event MarketCommitted(
        bytes32 indexed marketId,
        bytes32 indexed preCommitHash,
        uint64 committedAt,
        string marketRef
    );
    event MarketResolved(
        bytes32 indexed marketId,
        Outcome indexed outcome,
        bytes32 indexed contentHash,
        bytes32 preCommitHash,
        uint64 committedAt,
        uint64 resolvedAt,
        string attestationRef
    );
    event PublisherUpdated(address indexed previousPublisher, address indexed newPublisher);

    error NotOwner();
    error NotPublisher();
    error ZeroAddress();
    error ZeroHash();
    error AlreadyCommitted();
    error NotCommitted();
    error AlreadyResolved();
    error BadOutcome();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }
    modifier onlyPublisher() {
        if (msg.sender != publisher) revert NotPublisher();
        _;
    }

    /// @param publisher_ the address allowed to commit/resolve — the off-chain
    ///        Predge service that verifies its own ed25519 attestations before
    ///        publishing. Set at deploy; rotatable via `setPublisher`.
    constructor(address publisher_) {
        if (publisher_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        publisher = publisher_;
    }

    // ─────────────────────────── write path ───────────────────────────

    /// @notice Commit to a market BEFORE its outcome is knowable. This is the
    ///         half that makes the resolution honest: the chain timestamps the
    ///         commitment, so the later resolution provably could not have been
    ///         chosen with hindsight. One commitment per market, forever.
    /// @param marketId     keccak256("<platform>:<market id>")
    /// @param preCommitHash keccak256 of the exact ed25519-signed call bytes
    ///        (`canonical`) Predge published while the market was still open.
    /// @param marketRef    human/machine-readable pointer to the market + the
    ///        signed call (e.g. the Predge permalink) so anyone can fetch and
    ///        verify the bytes this hash commits to.
    function commitMarket(bytes32 marketId, bytes32 preCommitHash, string calldata marketRef)
        external
        onlyPublisher
    {
        if (preCommitHash == bytes32(0)) revert ZeroHash();
        Market storage m = _markets[marketId];
        if (m.committedAt != 0) revert AlreadyCommitted();

        m.preCommitHash = preCommitHash;
        m.committedAt = uint64(block.timestamp);
        commitCount += 1;

        emit MarketCommitted(marketId, preCommitHash, m.committedAt, marketRef);
    }

    /// @notice Record the settled outcome. Reverts unless the market was
    ///         committed first, and reverts if it was already resolved — so this
    ///         value is written exactly once and is permanent. There is
    ///         deliberately NO function to amend it.
    /// @param marketId   the committed market
    /// @param outcome    Yes / No / Invalid (never Unresolved)
    /// @param contentHash keccak256 of the exact ed25519-signed resolution bytes
    /// @param evidenceRef pointer to the Evidence Pack that re-verifies every
    ///        check live (signature, hash welding, binding) in a browser.
    function postResolution(
        bytes32 marketId,
        Outcome outcome,
        bytes32 contentHash,
        string calldata evidenceRef
    ) external onlyPublisher {
        if (outcome == Outcome.Unresolved) revert BadOutcome();
        if (contentHash == bytes32(0)) revert ZeroHash();

        Market storage m = _markets[marketId];
        if (m.committedAt == 0) revert NotCommitted();
        if (m.outcome != Outcome.Unresolved) revert AlreadyResolved();

        m.outcome = outcome;
        m.contentHash = contentHash;
        m.resolvedAt = uint64(block.timestamp);
        attestationRef[marketId] = evidenceRef;
        resolutionCount += 1;

        emit MarketResolved(
            marketId,
            outcome,
            contentHash,
            m.preCommitHash,
            m.committedAt,
            m.resolvedAt,
            evidenceRef
        );
    }

    /// @notice Rotate the publisher (e.g. after an operational key rotation).
    ///         Cannot alter any existing commitment or resolution.
    function setPublisher(address newPublisher) external onlyOwner {
        if (newPublisher == address(0)) revert ZeroAddress();
        emit PublisherUpdated(publisher, newPublisher);
        publisher = newPublisher;
    }

    // ─────────────────────────── read path ────────────────────────────
    // Free views: any Arc contract can settle against these with no fee and no
    // permission. Monetisation lives on the data API (x402 pay-per-call), never
    // on the composable read — an oracle you must pay to read is not an oracle.

    /// @notice Everything a settling contract needs, in one call.
    /// @return resolved      true once an outcome is permanently recorded
    /// @return outcome       Yes / No / Invalid (Unresolved while pending)
    /// @return contentHash   keccak256 of the signed resolution bytes
    /// @return preCommitHash keccak256 of the signed pre-outcome call bytes
    /// @return committedAt   chain time of the pre-outcome commitment
    /// @return resolvedAt    chain time the outcome was recorded (0 if pending)
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
        )
    {
        Market storage m = _markets[marketId];
        return (
            m.outcome != Outcome.Unresolved,
            m.outcome,
            m.contentHash,
            m.preCommitHash,
            m.committedAt,
            m.resolvedAt
        );
    }

    /// @notice Cheapest possible gate for a settling contract.
    function isResolved(bytes32 marketId) external view returns (bool) {
        return _markets[marketId].outcome != Outcome.Unresolved;
    }

    /// @notice Outcome only — `Unresolved` (0) while pending, so a consumer can
    ///         never mistake "not settled yet" for a positive result.
    function outcomeOf(bytes32 marketId) external view returns (Outcome) {
        return _markets[marketId].outcome;
    }

    /// @notice True once a market has been committed (whether or not settled) —
    ///         lets a market contract refuse to open if Predge never pre-committed.
    function isCommitted(bytes32 marketId) external view returns (bool) {
        return _markets[marketId].committedAt != 0;
    }

    /// @notice Seconds the outcome stayed open after Predge committed to its
    ///         call. Non-zero on every resolved market — the on-chain proof that
    ///         the call preceded the result. 0 while unresolved.
    function commitLeadTime(bytes32 marketId) external view returns (uint64) {
        Market storage m = _markets[marketId];
        if (m.outcome == Outcome.Unresolved) return 0;
        return m.resolvedAt - m.committedAt;
    }

    /// @notice Helper so off-chain callers and contracts derive marketId the same
    ///         way. Uses `abi.encode` (length-prefixed), NOT `encodePacked`:
    ///         packing two dynamic strings around a separator is ambiguous —
    ///         ("a", "b:c") and ("a:b", "c") would both pack to "a:b:c" and
    ///         collide onto one market key. Since a resolution is write-once,
    ///         such a collision would let one market's outcome permanently
    ///         occupy another's slot, so the encoding must be injective.
    function marketIdFor(string calldata platform, string calldata marketRef)
        external
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(platform, marketRef));
    }
}
