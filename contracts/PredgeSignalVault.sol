// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title  PredgeSignalVault
/// @notice A minimal, self-contained USDC vault on Circle Arc whose on-chain
///         "posture" (SHORT / FLAT / LONG a synthetic exposure) is steered by
///         Predge's ed25519-signed smart-money whale consensus. On Arc, USDC is
///         the native token, so deposits are plain `msg.value` and the vault
///         needs no ERC-20 plumbing and no external DeFi protocol — Arc testnet
///         is new and thin, so this vault deliberately depends on nothing but
///         Arc itself. Every rebalance records the signal hash + attestation
///         reference in an event, so the vault's whole decision history is
///         auditable on-chain.
///
/// @dev    TRUST BOUNDARY (disclosed, not hidden): verifying an ed25519
///         signature on-chain is expensive, so the authorized KEEPER verifies
///         the Predge attestation OFF-chain (node:crypto — see vault/attest.mjs)
///         and this contract records `signalHash` (keccak256 of the exact
///         signed bytes, `canonical`) plus `attestationRef`. The vault therefore
///         TRUSTS THE KEEPER to only rebalance on a valid, key-pinned Predge
///         attestation. That trust is externally checkable: the keeper's inputs
///         are independently verifiable for free against Predge's published key
///         registry (/.well-known/predge-keys.json) and /verify, and the signed
///         bytes are committed on-chain via `signalHash`. No upgradeability; the
///         owner can pause; depositors can always withdraw their own funds.
contract PredgeSignalVault {
    // -1 SHORT, 0 FLAT, +1 LONG. Stored as int8; only these three are valid.
    int8 public posture;
    uint64 public rebalanceCount;
    uint256 public totalDeposits;

    address public owner;
    address public keeper;
    bool public paused;

    // Last signal that moved the vault — an auditable pointer to off-chain proof.
    bytes32 public lastSignalHash;
    string public lastAttestationRef;

    mapping(address => uint256) public balanceOf;

    event Deposited(address indexed account, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed account, uint256 amount, uint256 newBalance);
    event Rebalanced(
        uint64 indexed seq,
        int8 oldPosture,
        int8 newPosture,
        uint16 targetExposureBps,
        bytes32 indexed signalHash,
        string attestationRef,
        address indexed keeper,
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
    ///        agent that verifies Predge attestations. Set at deploy; the owner
    ///        can rotate it later with `setKeeper`.
    constructor(address keeper_) {
        if (keeper_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        keeper = keeper_;
        posture = 0; // FLAT until the first signal
    }

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

    /// @notice Steer the vault's posture from a verified Predge signal. Callable
    ///         ONLY by the keeper, which MUST have already verified the Predge
    ///         ed25519 attestation off-chain (see the contract-level trust-
    ///         boundary note). The vault records the decision immutably.
    /// @param signalHash keccak256 of the exact signed attestation bytes
    ///        (`canonical`) — commits on-chain to what the keeper acted on.
    /// @param direction  -1 SHORT, 0 FLAT, +1 LONG (net smart-money direction).
    /// @param attestationRef human/machine-readable pointer to the off-chain
    ///        proof (scheme, key id, signature prefix, verify URL).
    function rebalance(bytes32 signalHash, int8 direction, string calldata attestationRef)
        external
        onlyKeeper
        whenNotPaused
    {
        if (direction < -1 || direction > 1) revert BadDirection();
        int8 old = posture;
        posture = direction;
        lastSignalHash = signalHash;
        lastAttestationRef = attestationRef;
        rebalanceCount += 1;
        emit Rebalanced(
            rebalanceCount,
            old,
            direction,
            _exposureBps(direction),
            signalHash,
            attestationRef,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Rotate the keeper (e.g. after a key rotation on the agent side).
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
            string memory lastAttestationRef_
        )
    {
        return (posture, rebalanceCount, totalDeposits, paused, lastSignalHash, lastAttestationRef);
    }
}
