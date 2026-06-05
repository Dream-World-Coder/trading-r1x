/**
 * lib/abi.ts
 * Canonical ABI derived from contracts/contracts/TradeReasoningMarket.sol
 *
 * Trace struct (on-chain):
 *   address creator
 *   string  ipfsCid
 *   uint256 wagingDeadline
 *   uint256 resolutionDeadline
 *   uint256 profitPool
 *   uint256 lossPool
 *   bool    resolved
 *   bool    wasProfitable
 *
 * NOTE: There is NO sha256Hash or registeredAt field in the struct.
 * There is NO getUserWager function — use the public profitWagers / lossWagers mappings.
 */

export const MARKET_ABI = [
    // ── View: getTrace ───────────────────────────────────────────────────────────
    {
        name: "getTrace",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "hash", type: "bytes32" }],
        outputs: [
            {
                type: "tuple",
                components: [
                    { name: "creator", type: "address" },
                    { name: "ipfsCid", type: "string" },
                    { name: "wagingDeadline", type: "uint256" },
                    { name: "resolutionDeadline", type: "uint256" },
                    { name: "profitPool", type: "uint256" },
                    { name: "lossPool", type: "uint256" },
                    { name: "resolved", type: "bool" },
                    { name: "wasProfitable", type: "bool" },
                ],
            },
        ],
    },

    // ── View: previewPayout ──────────────────────────────────────────────────────
    {
        name: "previewPayout",
        type: "function",
        stateMutability: "view",
        inputs: [
            { name: "hash", type: "bytes32" },
            { name: "isProfit", type: "bool" },
            { name: "userStake", type: "uint256" },
        ],
        outputs: [{ name: "", type: "uint256" }],
    },

    // ── View: public mapping getters ─────────────────────────────────────────────
    {
        name: "profitWagers",
        type: "function",
        stateMutability: "view",
        inputs: [
            { name: "", type: "bytes32" },
            { name: "", type: "address" },
        ],
        outputs: [{ type: "uint256" }],
    },
    {
        name: "lossWagers",
        type: "function",
        stateMutability: "view",
        inputs: [
            { name: "", type: "bytes32" },
            { name: "", type: "address" },
        ],
        outputs: [{ type: "uint256" }],
    },
    {
        name: "hasClaimed",
        type: "function",
        stateMutability: "view",
        inputs: [
            { name: "", type: "bytes32" },
            { name: "", type: "address" },
        ],
        outputs: [{ type: "bool" }],
    },

    // ── Write: placeWager ────────────────────────────────────────────────────────
    {
        name: "placeWager",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "hash", type: "bytes32" },
            { name: "isProfit", type: "bool" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [],
    },

    // ── Write: claimWinnings ─────────────────────────────────────────────────────
    {
        name: "claimWinnings",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [{ name: "hash", type: "bytes32" }],
        outputs: [],
    },
] as const;

export const ERC20_ABI = [
    {
        name: "approve",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
            { name: "spender", type: "address" },
            { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
    },
    {
        name: "allowance",
        type: "function",
        stateMutability: "view",
        inputs: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
        ],
        outputs: [{ type: "uint256" }],
    },
] as const;

// ── Types matching the on-chain struct ──────────────────────────────────────

export interface OnChainTrace {
    creator: `0x${string}`;
    ipfsCid: string;
    wagingDeadline: bigint;
    resolutionDeadline: bigint;
    profitPool: bigint;
    lossPool: bigint;
    resolved: boolean;
    wasProfitable: boolean;
}
