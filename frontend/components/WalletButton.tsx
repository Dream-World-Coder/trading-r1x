/**
 * components/WalletButton.tsx
 * ============================
 * Reusable wallet connect / disconnect button.
 * All hook logic is unchanged — only visual layer updated.
 */

"use client";

import { useAccount, useConnect, useDisconnect, useReadContract } from "wagmi";
import { injected } from "wagmi/connectors";
import { formatUnits } from "viem";
import { CONTRACT_ADDRESSES } from "@/wagmi.config";

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
                    <div
                        className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-sm border"
                        style={{
                            borderColor: "var(--paper-rule)",
                            background: "var(--paper-warm)",
                        }}
                    >
                        <span
                            className="mono-xs"
                            style={{ color: "var(--ink-3)" }}
                        >
                            {parseFloat(
                                formatUnits(balance as bigint, 6),
                            ).toFixed(2)}{" "}
                            USDC
                        </span>
                    </div>
                )}
                <button
                    onClick={() => disconnect()}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-sm border text-sm transition-colors"
                    style={{
                        borderColor: "var(--paper-rule)",
                        background: "var(--paper-warm)",
                        color: "var(--ink-2)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.72rem",
                    }}
                    onMouseEnter={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor =
                            "var(--red-border)";
                        (e.currentTarget as HTMLElement).style.color =
                            "var(--red)";
                    }}
                    onMouseLeave={(e) => {
                        (e.currentTarget as HTMLElement).style.borderColor =
                            "var(--paper-rule)";
                        (e.currentTarget as HTMLElement).style.color =
                            "var(--ink-2)";
                    }}
                >
                    {/* Connected indicator */}
                    <span
                        className="h-1.5 w-1.5 rounded-full shrink-0 pulse"
                        style={{ background: "var(--green)" }}
                    />
                    {address.slice(0, 6)}…{address.slice(-4)}
                </button>
            </div>
        );
    }

    return (
        <button
            onClick={() => connect({ connector: injected() })}
            className="btn-primary"
        >
            Connect Wallet
        </button>
    );
}
