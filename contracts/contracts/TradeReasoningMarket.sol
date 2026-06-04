// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TradeReasoningMarket is Ownable {
    IERC20 public usdc;
    uint256 public protocolFeeBalance;

    uint256 public constant MIN_WAGER = 1e6; // 1 USDC (assuming 6 decimals)
    uint256 public constant MAX_WAGER = 10000 * 1e6; // 10,000 USDC

    struct Trace {
        address creator;
        string ipfsCid;
        uint256 wagingDeadline;
        uint256 resolutionDeadline;
        uint256 profitPool;
        uint256 lossPool;
        bool resolved;
        bool wasProfitable;
    }

    mapping(bytes32 => Trace) public traces;
    mapping(bytes32 => mapping(address => uint256)) public profitWagers;
    mapping(bytes32 => mapping(address => uint256)) public lossWagers;
    mapping(bytes32 => mapping(address => bool)) public hasClaimed;

    event TraceRegistered(
        bytes32 indexed hash,
        string cid,
        address indexed creator,
        uint256 wagingDeadline
    );
    event WagerPlaced(
        bytes32 indexed hash,
        address indexed user,
        uint256 amount,
        bool isProfit
    );
    event TraceResolved(
        bytes32 indexed hash,
        bool wasProfitable,
        uint256 profitPool,
        uint256 lossPool
    );
    event WinningsClaimed(
        bytes32 indexed hash,
        address indexed user,
        uint256 amount
    );

    error TraceAlreadyRegistered();
    error InvalidDeadlines();
    error WagingClosed();
    error AlreadyWagered();
    error WagerBelowMinimum();
    error WagerAboveMaximum();
    error TraceAlreadyResolved();
    error TraceNotResolved();
    error NothingToClaim();
    error AlreadyClaimed();

    constructor(address _usdc) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
    }

    function registerTrace(
        bytes32 hash,
        string calldata cid,
        uint256 wagingWindow,
        uint256 resolutionWindow
    ) external {
        if (traces[hash].creator != address(0)) revert TraceAlreadyRegistered();
        if (wagingWindow == 0) revert InvalidDeadlines();

        uint256 wDeadline = block.timestamp + wagingWindow;
        traces[hash] = Trace({
            creator: msg.sender,
            ipfsCid: cid,
            wagingDeadline: wDeadline,
            resolutionDeadline: block.timestamp + resolutionWindow,
            profitPool: 0,
            lossPool: 0,
            resolved: false,
            wasProfitable: false
        });

        emit TraceRegistered(hash, cid, msg.sender, wDeadline);
    }

    function placeWager(bytes32 hash, bool isProfit, uint256 amount) external {
        Trace storage trace = traces[hash];
        if (block.timestamp > trace.wagingDeadline) revert WagingClosed();
        if (amount < MIN_WAGER) revert WagerBelowMinimum();
        if (amount > MAX_WAGER) revert WagerAboveMaximum();
        if (
            profitWagers[hash][msg.sender] > 0 ||
            lossWagers[hash][msg.sender] > 0
        ) revert AlreadyWagered();

        usdc.transferFrom(msg.sender, address(this), amount);

        if (isProfit) {
            profitWagers[hash][msg.sender] = amount;
            trace.profitPool += amount;
        } else {
            lossWagers[hash][msg.sender] = amount;
            trace.lossPool += amount;
        }

        emit WagerPlaced(hash, msg.sender, amount, isProfit);
    }

    function resolveTrace(bytes32 hash, bool profitable) external onlyOwner {
        Trace storage trace = traces[hash];
        if (trace.resolved) revert TraceAlreadyResolved();

        trace.resolved = true;
        trace.wasProfitable = profitable;

        emit TraceResolved(hash, profitable, trace.profitPool, trace.lossPool);
    }

    function previewPayout(
        bytes32 hash,
        bool isProfit,
        uint256 userStake
    ) public view returns (uint256) {
        Trace memory trace = traces[hash];

        if (trace.profitPool == 0 || trace.lossPool == 0) {
            return userStake; // Refund if no opposing bets
        }

        uint256 loserPool = isProfit ? trace.lossPool : trace.profitPool;
        uint256 winnerPool = isProfit ? trace.profitPool : trace.lossPool;

        uint256 fee = (loserPool * 2) / 100;
        uint256 distributable = loserPool - fee;

        return userStake + ((userStake * distributable) / winnerPool);
    }

    function claimWinnings(bytes32 hash) external {
        Trace storage trace = traces[hash];
        if (!trace.resolved) revert TraceNotResolved();
        if (hasClaimed[hash][msg.sender]) revert AlreadyClaimed();

        uint256 userStake = trace.wasProfitable
            ? profitWagers[hash][msg.sender]
            : lossWagers[hash][msg.sender];

        // Check for refund scenario (no opposing bets) before asserting win/loss
        if (trace.profitPool == 0 || trace.lossPool == 0) {
            userStake = profitWagers[hash][msg.sender] > 0
                ? profitWagers[hash][msg.sender]
                : lossWagers[hash][msg.sender];
        } else if (userStake == 0) {
            revert NothingToClaim();
        }

        hasClaimed[hash][msg.sender] = true;
        uint256 payout = previewPayout(hash, trace.wasProfitable, userStake);

        if (trace.profitPool > 0 && trace.lossPool > 0) {
            uint256 loserPool = trace.wasProfitable
                ? trace.lossPool
                : trace.profitPool;
            uint256 winnerPool = trace.wasProfitable
                ? trace.profitPool
                : trace.lossPool;
            uint256 fee = (loserPool * 2) / 100;
            // Only add to protocol balance proportionately to avoid rounding errors locking funds
            protocolFeeBalance += (fee * userStake) / winnerPool;
        }

        usdc.transfer(msg.sender, payout);
        emit WinningsClaimed(hash, msg.sender, payout);
    }

    function withdrawProtocolFees(address to) external onlyOwner {
        uint256 amount = protocolFeeBalance;
        protocolFeeBalance = 0;
        usdc.transfer(to, amount);
    }

    function getTrace(bytes32 hash) external view returns (Trace memory) {
        return traces[hash];
    }
}
