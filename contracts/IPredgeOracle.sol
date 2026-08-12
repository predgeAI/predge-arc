// SPDX-License-Identifier: MIT
// Deliberately wide pragma: this file is meant to be IMPORTED into someone
// else's build. It uses nothing newer than 0.8.0, so a consumer pinned to an
// older 0.8.x does not have to bump their compiler to settle against Cachet.
pragma solidity >=0.8.0 <0.9.0;

/// @title  IPredgeOracle — the consumer-facing interface to Cachet (`PredgeOracle`)
/// @notice Import this, point it at the deployment, and settle. Every function
///         here is a free `view`: reading an outcome costs a consumer nothing,
///         needs no permission, no key, no account and no allowlist. Predge
///         monetises the data API, never the composable read — an oracle you
///         must pay to read is not an oracle.
///
///         Arc testnet (chainId 5042002):
///           PredgeOracle  0xF160AbE664C34CF4C117101b4308bb16325a1ABc
///
///         WHAT THE CHAIN GUARANTEES, for every market you can read here:
///           1. ORDERING. `commitMarket` recorded keccak256 of Predge's
///              ed25519-signed call BEFORE the outcome was knowable, and the
///              chain timestamped it. `postResolution` REVERTS unless that
///              commitment already exists. An outcome therefore cannot be
///              chosen with hindsight and then back-dated.
///           2. IMMUTABILITY. A resolution is written exactly once. There is no
///              edit path, no upgrade, no proxy, no admin override and no
///              governance vote — not even the publisher can revise a settled
///              market. `commitLeadTime` is the on-chain receipt of (1): the
///              seconds the outcome stayed open after Predge committed.
///
///         WHAT IT DOES *NOT* GUARANTEE — read this before you route money:
///           - NOT that a market will ever be resolved. The publisher can commit
///             and then go silent forever. Nothing in this interface, and
///             nothing in the contract, promises liveness. A consumer holding
///             user funds MUST have its own timeout/void path or those funds are
///             locked permanently. `ExampleMarket.RESOLUTION_GRACE` is the
///             worked example.
///           - NOT that the outcome is correct. It guarantees the outcome was
///             committed to before it was knowable and never edited after. That
///             is a different — and checkable — property from "true".
///           - NOT any notification. These are views. There is no callback, no
///             push, no hook. You poll, or someone pokes your contract.
///           - NOT a dispute window. There is no challenge period, no appeal, no
///             quorum. Finality here is the chain's finality and nothing more.
///           - NOT cross-chain. The address above is an Arc testnet deployment
///             reached by nonce, not CREATE2. Do not assume the same address on
///             any other chain holds this code.
///
/// @dev    TRUST BOUNDARY (disclosed, not hidden): verifying an ed25519
///         signature on-chain is prohibitively expensive, so the authorized
///         PUBLISHER verifies Predge's signed attestation OFF-chain
///         (`node:crypto` — see vault/attest.mjs) and the contract commits to
///         `preCommitHash` / `contentHash`, the keccak256 of the exact signed
///         bytes. What you must trust the publisher for: that the bytes it
///         hashed say what it claims. What you do NOT have to trust anyone for,
///         because the CHAIN enforces it: that the commitment predates the
///         resolution, and that the resolution was never altered afterwards.
///         Both signed payloads stay independently verifiable for free, offline,
///         against Predge's published key registry
///         (/.well-known/predge-keys.json, whose own sha256 is anchored on Arc)
///         — the on-chain hashes are what make "the bytes I verify are the bytes
///         it settled on" checkable. See `verify-cachet.mjs`, a standalone file
///         that imports no Predge code and needs only a public RPC endpoint.
///
///         SURFACE CHOSEN, AND WHAT WAS LEFT OUT. This interface is the
///         SETTLEMENT surface only. The deployment also exposes `owner()`,
///         `publisher()`, `commitCount()`, `resolutionCount()` and the write
///         path (`commitMarket`, `postResolution`, `setPublisher`). Those are
///         operational surface: a consumer that settles against them is
///         depending on Predge's key management rather than on the chain's
///         ordering guarantee, so they are deliberately absent here. Declare
///         them yourself if you want them — this file stays the part that is
///         safe to depend on. It is an interface, not an abstract contract:
///         importing it adds ZERO bytecode to your build.
interface IPredgeOracle {
    /// @notice Settlement state of a market.
    /// @dev    `Unresolved` is the ZERO value — deliberately. An unknown
    ///         marketId, a typo'd marketId, and a market that is genuinely still
    ///         open all read as `Unresolved`, so a consumer can never mistake
    ///         "nothing is recorded here" for a positive result. The corollary
    ///         is the hazard: `Unresolved` is NOT a NO. Never write
    ///         `if (outcome != Outcome.Yes) { payNoSide(); }`.
    ///
    ///         `Invalid` is a real settled state, not an error code: the market
    ///         voided (the event never happened, the question was malformed, the
    ///         source was withdrawn). It is recorded honestly rather than forced
    ///         into YES/NO, which means YOU must decide what it does to money.
    ///         For a two-sided market, "refund both sides" is almost always the
    ///         only defensible answer — a non-event is not a loss for either
    ///         side, and confiscating stakes because nothing happened is theft.
    ///
    ///         Decoding an out-of-range value into this enum PANICS (0x21). That
    ///         is fail-closed and intentional, but it means a consumer pointed
    ///         at a hostile contract can have its settlement path bricked — one
    ///         more reason for the timeout path described above.
    enum Outcome {
        Unresolved,
        Yes,
        No,
        Invalid
    }

    // ─────────────────────────────── events ───────────────────────────────
    // Signatures are byte-identical to the deployment, so `topic0` matches and
    // an indexer built on this interface decodes the real logs.
    //
    // INDEXER HAZARD: any contract can emit logs with these exact topics. A log
    // is only a Predge log if `log.address` is the oracle deployment. Always
    // filter by address; never trust a topic match alone.

    /// @notice Emitted when Predge commits to a market BEFORE the outcome is
    ///         knowable. `committedAt` is chain time — this is the timestamp the
    ///         whole guarantee rests on.
    /// @param marketId      keccak256(abi.encode(platform, marketRef))
    /// @param preCommitHash keccak256 of the exact ed25519-signed call bytes
    /// @param committedAt   block timestamp of the commitment
    /// @param marketRef     pointer to the market + the signed call, so anyone
    ///                      can fetch the bytes this hash commits to
    event MarketCommitted(
        bytes32 indexed marketId,
        bytes32 indexed preCommitHash,
        uint64 committedAt,
        string marketRef
    );

    /// @notice Emitted exactly once per market, when the outcome is recorded.
    ///         There is no corresponding "MarketRevised" event because there is
    ///         no revision path — this log is the final word for `marketId`.
    /// @dev    Carries `preCommitHash` and `committedAt` alongside the result so
    ///         an indexer can compute the lead time from a SINGLE log without
    ///         joining back to the commit event.
    event MarketResolved(
        bytes32 indexed marketId,
        Outcome indexed outcome,
        bytes32 indexed contentHash,
        bytes32 preCommitHash,
        uint64 committedAt,
        uint64 resolvedAt,
        string attestationRef
    );

    // ──────────────────────────────── views ───────────────────────────────

    /// @notice Everything a settling contract needs, in one call. This is the
    ///         function to build on: reading `outcome` without `resolved`,
    ///         `committedAt` and `resolvedAt` throws away the evidence that the
    ///         outcome was pre-committed.
    /// @dev    GUARANTEES: if `resolved` is true, `outcome` is one of Yes/No/
    ///         Invalid (never Unresolved), `contentHash` is non-zero,
    ///         `committedAt` is non-zero, and `resolvedAt >= committedAt` — the
    ///         contract cannot record a resolution any other way. Those values
    ///         are permanent; a later call returns the same tuple forever.
    ///
    ///         DOES NOT GUARANTEE: that `marketId` is a market you meant. An
    ///         unknown key returns all zeros with `resolved == false`, which is
    ///         indistinguishable from a live pending market. Derive the id with
    ///         `marketIdFor` (or the same `abi.encode`) and gate on
    ///         `isCommitted` so a bad key reverts instead of hanging forever.
    /// @param marketId       keccak256(abi.encode(platform, marketRef))
    /// @return resolved      true once an outcome is permanently recorded
    /// @return outcome       Yes / No / Invalid (Unresolved while pending)
    /// @return contentHash   keccak256 of the signed resolution bytes — hand
    ///                       this to `verify-cachet.mjs` to check the signature
    ///                       offline against the published key registry
    /// @return preCommitHash keccak256 of the signed pre-outcome call bytes
    /// @return committedAt   chain time of the pre-outcome commitment (0 if the
    ///                       market was never committed, i.e. does not exist)
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
        );

    /// @notice Cheapest possible gate: is there a permanent outcome for this
    ///         market yet?
    /// @dev    GUARANTEES: once true, true forever. Use it to close betting the
    ///         instant the oracle speaks — a market that keeps accepting stakes
    ///         after resolution is handing out a risk-free option on a known
    ///         result.
    ///         DOES NOT GUARANTEE: anything about WHICH outcome, and false says
    ///         nothing about whether the market exists.
    function isResolved(bytes32 marketId) external view returns (bool);

    /// @notice The outcome alone, for callers that already know the market is
    ///         resolved.
    /// @dev    Returns `Unresolved` (0) for a pending market, an unknown market,
    ///         and a mistyped marketId alike. If your code branches on this
    ///         value without first checking `isResolved` (or `resolved` from
    ///         `getResolution`), a typo settles as "not YES" — which is why the
    ///         cheap-looking call is the dangerous one. Prefer `getResolution`.
    function outcomeOf(bytes32 marketId) external view returns (Outcome);

    /// @notice Has Predge pre-committed to this market? True from the commitment
    ///         onward, whether or not it has settled.
    /// @dev    THE GATE THAT MATTERS AT OPENING TIME. Check this BEFORE you
    ///         accept a single unit of stake. Without it, anyone can point your
    ///         market contract at an arbitrary bytes32 that Predge never
    ///         committed to — which will then never resolve, because
    ///         `postResolution` reverts on an uncommitted market. Pair it with
    ///         `!isResolved` in the same constructor: a pool opened on an
    ///         ALREADY-settled market is a pool opened on a known result.
    function isCommitted(bytes32 marketId) external view returns (bool);

    /// @notice `resolvedAt - committedAt`: the seconds the outcome stayed open
    ///         after Predge committed to its call. This is the number that makes
    ///         the guarantee legible — a long lead time is on-chain proof the
    ///         call preceded the result.
    /// @dev    RETURNS 0 IN TWO DIFFERENT SITUATIONS, and conflating them is a
    ///         real hazard: (a) the market is unresolved, and (b) it was
    ///         committed and resolved inside the SAME block — which is the
    ///         pathological case a lead-time check exists to catch. Always read
    ///         `resolved` from `getResolution` first; only then is a small lead
    ///         time meaningful. A commitment made seconds before a known outcome
    ///         is technically valid and structurally sound — and still tells you
    ///         something. Set your own floor and refuse below it.
    ///
    ///         Block timestamps are validator-influenced at second scale, so do
    ///         not build thresholds tighter than the chain's own tolerance.
    function commitLeadTime(bytes32 marketId) external view returns (uint64);

    /// @notice Pointer to the off-chain evidence for a resolution — an Evidence
    ///         Pack URL, or the entire signed envelope inline when the publisher
    ///         used `--embed`.
    /// @dev    FOR OFF-CHAIN USE. The string is publisher-controlled and
    ///         unbounded, so reading it from a state-changing path imports
    ///         unbounded memory-expansion gas into your settlement — a market
    ///         whose `settle()` reads this can be made too expensive to call.
    ///         Read it from your indexer or your UI, never from `settle()`.
    ///
    ///         A URL proves less than an embedded envelope: the hash is on-chain
    ///         forever, but a preimage that lives on a web server can disappear.
    ///         If your protocol's audit story depends on producing the signed
    ///         bytes later, archive them yourself at commitment time.
    function attestationRef(bytes32 marketId) external view returns (string memory);

    /// @notice Derive a marketId the same way the oracle does. Use this (or
    ///         replicate the encoding exactly) so your key and Predge's key are
    ///         the same key.
    /// @dev    Uses `abi.encode` (length-prefixed), NOT `encodePacked`: packing
    ///         two dynamic strings around a separator is ambiguous — ("a", "b:c")
    ///         and ("a:b", "c") both pack to "a:b:c" and would collide onto one
    ///         market key. Since a resolution is write-once, such a collision
    ///         would let one market's outcome permanently occupy another's slot.
    ///         `pure`, so calling it costs nothing off-chain; on-chain, prefer
    ///         computing `keccak256(abi.encode(platform, marketRef))` locally
    ///         over paying for an external call to learn a hash you can derive.
    function marketIdFor(string calldata platform, string calldata marketRef)
        external
        pure
        returns (bytes32);
}
