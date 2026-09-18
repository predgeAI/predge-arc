// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal view of Circle's Refund Protocol that an arbiter needs.
interface IRefundProtocol {
    function refundByArbiter(uint256 paymentID) external;
    function setLockupSeconds(address recipient, uint256 recipientLockupSeconds) external;
}

/// @title PredgeRefundArbiter
/// @notice A bonded arbiter for Circle's Refund Protocol.
///
/// Refund Protocol gives the arbiter seat unchecked power: whoever holds it can refund a payment
/// on a whim, and Circle's own README flags that an arbiter can drain payments through early
/// withdrawal. This contract takes that seat and gives it back constraints:
///
///   1. Commit first. Before ruling, the arbiter records `sha256(evidence)` and the direction it
///      will rule, so the reasoning exists before the money moves and cannot be written afterwards.
///   2. Stake. Every ruling is backed by native value held here. The bond is only reclaimable once
///      the challenge window has passed without a successful challenge.
///   3. Slashable. Anyone can submit the evidence bytes. If they hash to something other than what
///      was committed, the ruling was not the one promised and the bond goes to the challenger.
///
/// The contract never holds user payments. It only acts on Refund Protocol, so the worst an
/// operator can do is rule wrongly, and that costs the bond.
contract PredgeRefundArbiter {
    struct Ruling {
        bytes32 evidenceHash;   // sha256 of the evidence the ruling is based on, committed first
        uint96 bond;            // native value staked behind it
        uint64 ruledAt;         // chain time of the ruling
        address decidedBy;      // the operator key that ruled
        Direction direction;    // refund the payer, or leave the payment with the recipient
        bool settled;           // bond reclaimed or slashed
    }

    enum Direction { None, Refund, Release }

    address public owner;
    address public operator;          // the key that rules day to day; rotatable, never holds funds
    IRefundProtocol public immutable refundProtocol;
    uint64 public challengeWindow;    // seconds a ruling stays challengeable
    uint96 public minBond;            // floor for a ruling's stake
    uint64 public rulingCount;
    uint64 public slashCount;

    mapping(uint256 => Ruling) public rulings;   // paymentID => ruling

    event OperatorUpdated(address indexed previousOperator, address indexed newOperator);
    event Committed(uint256 indexed paymentID, bytes32 evidenceHash, Direction direction, uint96 bond);
    event Ruled(uint256 indexed paymentID, Direction direction, bytes32 evidenceHash, uint64 ruledAt);
    event Slashed(uint256 indexed paymentID, address indexed challenger, uint96 bond, bytes32 committed, bytes32 delivered);
    event Reclaimed(uint256 indexed paymentID, uint96 bond);
    event ParamsUpdated(uint64 challengeWindow, uint96 minBond);

    error NotOwner();
    error NotOperator();
    error ZeroAddress();
    error ZeroHash();
    error BondTooSmall();
    error AlreadyRuled(uint256 paymentID);
    error NotRuled(uint256 paymentID);
    error AlreadySettled(uint256 paymentID);
    error WindowOpen(uint256 paymentID);
    error RulingHonest(uint256 paymentID);
    error TransferFailed();
    error BadDirection();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address refundProtocol_, address operator_, uint64 challengeWindow_, uint96 minBond_) {
        if (refundProtocol_ == address(0) || operator_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        operator = operator_;
        refundProtocol = IRefundProtocol(refundProtocol_);
        challengeWindow = challengeWindow_;
        minBond = minBond_;
    }

    /// @notice Rule on a payment, staking the bond and committing the evidence in the same call.
    /// @param paymentID    the Refund Protocol payment being ruled on
    /// @param evidenceHash sha256 of the exact evidence bytes behind the ruling
    /// @param direction    Refund sends the payment back to the payer's refundTo; Release leaves it
    function rule(uint256 paymentID, bytes32 evidenceHash, Direction direction) external payable onlyOperator {
        if (evidenceHash == bytes32(0)) revert ZeroHash();
        if (direction == Direction.None) revert BadDirection();
        if (msg.value < minBond) revert BondTooSmall();
        Ruling storage r = rulings[paymentID];
        if (r.ruledAt != 0) revert AlreadyRuled(paymentID);

        r.evidenceHash = evidenceHash;
        r.bond = uint96(msg.value);
        r.ruledAt = uint64(block.timestamp);
        r.decidedBy = msg.sender;
        r.direction = direction;
        rulingCount += 1;

        emit Committed(paymentID, evidenceHash, direction, uint96(msg.value));
        if (direction == Direction.Refund) {
            refundProtocol.refundByArbiter(paymentID);
        }
        emit Ruled(paymentID, direction, evidenceHash, uint64(block.timestamp));
    }

    /// @notice Show that the evidence behind a ruling is not what was committed, and take the bond.
    /// @dev sha256 is the 0x02 precompile, so a challenge costs a few thousand gas and needs no oracle.
    function challenge(uint256 paymentID, bytes calldata evidence) external {
        Ruling storage r = rulings[paymentID];
        if (r.ruledAt == 0) revert NotRuled(paymentID);
        if (r.settled) revert AlreadySettled(paymentID);
        bytes32 delivered = sha256(evidence);
        if (delivered == r.evidenceHash) revert RulingHonest(paymentID);

        uint96 bond = r.bond;
        r.settled = true;
        r.bond = 0;
        slashCount += 1;
        emit Slashed(paymentID, msg.sender, bond, r.evidenceHash, delivered);
        (bool ok,) = payable(msg.sender).call{value: bond}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice After the challenge window with no successful challenge, take the bond back.
    function reclaim(uint256 paymentID) external onlyOperator {
        Ruling storage r = rulings[paymentID];
        if (r.ruledAt == 0) revert NotRuled(paymentID);
        if (r.settled) revert AlreadySettled(paymentID);
        if (block.timestamp < r.ruledAt + challengeWindow) revert WindowOpen(paymentID);

        uint96 bond = r.bond;
        r.settled = true;
        r.bond = 0;
        emit Reclaimed(paymentID, bond);
        (bool ok,) = payable(msg.sender).call{value: bond}("");
        if (!ok) revert TransferFailed();
    }

    /// @notice Pass a recipient's lockup change through to Refund Protocol.
    function setLockupSeconds(address recipient, uint256 recipientLockupSeconds) external onlyOwner {
        refundProtocol.setLockupSeconds(recipient, recipientLockupSeconds);
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        emit OperatorUpdated(operator, newOperator);
        operator = newOperator;
    }

    function setParams(uint64 challengeWindow_, uint96 minBond_) external onlyOwner {
        challengeWindow = challengeWindow_;
        minBond = minBond_;
        emit ParamsUpdated(challengeWindow_, minBond_);
    }

    /// @notice Would this evidence slash the ruling? A read-only check before spending gas.
    function wouldSlash(uint256 paymentID, bytes calldata evidence) external view returns (bool) {
        Ruling storage r = rulings[paymentID];
        return r.ruledAt != 0 && !r.settled && sha256(evidence) != r.evidenceHash;
    }

    function rulingOf(uint256 paymentID)
        external
        view
        returns (bytes32 evidenceHash, uint96 bond, uint64 ruledAt, Direction direction, bool settled)
    {
        Ruling storage r = rulings[paymentID];
        return (r.evidenceHash, r.bond, r.ruledAt, r.direction, r.settled);
    }
}
