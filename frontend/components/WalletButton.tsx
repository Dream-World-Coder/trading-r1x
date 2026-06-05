/**
 * components/WalletButton.tsx
 * ============================
 * Reusable wallet connect / disconnect button used by all pages.
 */

"use client";

import { useAccount, useConnect, useDisconnect, useReadContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { formatUnits } from "viem";
import { CONTRACT_ADDRESSES } from "@/wagmi.config";

// Minimal ABI to fetch ERC20 balances
const ERC20_ABI = [
    {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "account", type: "address" }],
        outputs: [{ type: "uint256" }],
    },
] as const;

export default function WalletButton() {
    const { address, isConnected } = useAccount();
    const { connect } = useConnect();
    const { disconnect } = useDisconnect();

    const { data: balance } = useReadContract({
        address: CONTRACT_ADDRESSES.USDC,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: address ? [address] : undefined,
        query: { enabled: !!address },
    });

    if (isConnected && address) {
        return (
            <div className="flex items-center gap-2">
                {balance !== undefined && (
                    <div className="hidden sm:flex rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-400 font-mono">
                        {parseFloat(formatUnits(balance as bigint, 6)).toFixed(
                            2,
                        )}{" "}
                        USDC
                    </div>
                )}
                <button
                    onClick={() => disconnect()}
                    className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-1.5 text-sm text-slate-300 hover:border-red-500/50 hover:text-red-400 transition-colors"
                >
                    <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                    {address.slice(0, 6)}…{address.slice(-4)}
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={() => connect({ connector: injected() })}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors"
        >
            Connect Wallet
        </button>
    );
}
