/**
 * components/WagerForm.tsx
 * Two-step approve → placeWager flow with live payout preview.
 */

"use client";

import { useState, useEffect } from "react";
import {
    useAccount,
    useReadContract,
    useWriteContract,
    useWaitForTransactionReceipt,
} from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { MARKET_ABI, ERC20_ABI } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/wagmi.config";

interface WagerFormProps {
    traceHash: `0x${string}`;
}

type Step = "input" | "approving" | "wagering" | "done";

export function WagerForm({ traceHash }: WagerFormProps) {
    const { address, isConnected } = useAccount();
    const [prediction, setPrediction] = useState<boolean | null>(null); // true=profit, false=loss
    const [amount, setAmount] = useState("");
    const [step, setStep] = useState<Step>("input");

    // ── Read current allowance ──────────────────────────────────────────────────
    const { data: allowance, refetch: refetchAllowance } = useReadContract({
        address: CONTRACT_ADDRESSES.USDC,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: address
            ? [address, CONTRACT_ADDRESSES.TradeReasoningMarket]
            : undefined,
        query: { enabled: !!address },
    });

    // ── Live payout preview ─────────────────────────────────────────────────────
    const amountUnits =
        amount && !isNaN(Number(amount)) && Number(amount) > 0
            ? parseUnits(amount, 6)
            : 0n;

    const { data: estimatedPayout } = useReadContract({
        address: CONTRACT_ADDRESSES.TradeReasoningMarket,
        abi: MARKET_ABI,
        functionName: "previewPayout",
        args:
            prediction !== null && amountUnits > 0n
                ? [traceHash, prediction, amountUnits]
                : undefined,
        query: { enabled: prediction !== null && amountUnits > 0n },
    });

    // ── Approve USDC ────────────────────────────────────────────────────────────
    const {
        writeContract: approve,
        data: approveTxHash,
        isPending: approveIsPending,
        reset: resetApprove,
    } = useWriteContract();

    const { isSuccess: approveSuccess } = useWaitForTransactionReceipt({
        hash: approveTxHash,
    });

    // After approval confirmed, refetch allowance
    useEffect(() => {
        if (approveSuccess) {
            refetchAllowance();
            setStep("input");
        }
    }, [approveSuccess, refetchAllowance]);

    // ── Place wager ─────────────────────────────────────────────────────────────
    const {
        writeContract: placeWager,
        data: wagerTxHash,
        isPending: wagerIsPending,
    } = useWriteContract();

    const { isSuccess: wagerSuccess } = useWaitForTransactionReceipt({
        hash: wagerTxHash,
    });

    useEffect(() => {
        if (wagerSuccess) setStep("done");
    }, [wagerSuccess]);

    // ── Derived state ───────────────────────────────────────────────────────────
    const needsApproval =
        allowance !== undefined && amountUnits > 0n && allowance < amountUnits;

    const canSubmit =
        isConnected &&
        prediction !== null &&
        amountUnits > 0n &&
        !approveIsPending &&
        !wagerIsPending;

    function handleCTA() {
        if (!canSubmit) return;
        if (needsApproval) {
            setStep("approving");
            approve({
                address: CONTRACT_ADDRESSES.USDC,
                abi: ERC20_ABI,
                functionName: "approve",
                args: [CONTRACT_ADDRESSES.TradeReasoningMarket, amountUnits],
            });
        } else {
            setStep("wagering");
            placeWager({
                address: CONTRACT_ADDRESSES.TradeReasoningMarket,
                abi: MARKET_ABI,
                functionName: "placeWager",
                args: [traceHash, prediction!, amountUnits],
            });
        }
    }

    // ── Not connected ────────────────────────────────────────────────────────────
    if (!isConnected) {
        return (
            <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center">
                <p className="text-sm text-slate-500">
                    Connect your wallet to wager USDC on this trace.
                </p>
            </div>
        );
    }

    // ── Done ─────────────────────────────────────────────────────────────────────
    if (step === "done") {
        return (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-2">
                <div className="text-2xl">✅</div>
                <p className="font-semibold text-emerald-400">Wager placed!</p>
                {wagerTxHash && (
                    <a
                        href={`https://testnet.arcscan.app/tx/${wagerTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block font-mono text-xs text-indigo-400 hover:underline"
                    >
                        {wagerTxHash.slice(0, 20)}… ↗
                    </a>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Prediction toggle */}
            <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-slate-500">
                    Your prediction
                </label>
                <div className="grid grid-cols-2 gap-2">
                    {(
                        [
                            {
                                value: true,
                                label: "📈 Will Profit",
                                active: "border-emerald-500 bg-emerald-500/10 text-emerald-400",
                            },
                            {
                                value: false,
                                label: "📉 Will Lose",
                                active: "border-red-500 bg-red-500/10 text-red-400",
                            },
                        ] as const
                    ).map(({ value, label, active }) => (
                        <button
                            key={String(value)}
                            onClick={() => setPrediction(value)}
                            className={`rounded-lg border px-4 py-3 text-sm font-semibold transition-all ${
                                prediction === value
                                    ? active
                                    : "border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500"
                            }`}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Amount input */}
            <div>
                <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-slate-500">
                    Wager amount
                </label>
                <div className="relative">
                    <input
                        type="number"
                        min="1"
                        max="10000"
                        placeholder="10"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 pr-16 text-white placeholder-slate-600 focus:border-indigo-500 focus:outline-none transition-colors"
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-500">
                        USDC
                    </span>
                </div>
                <div className="mt-2 flex gap-2">
                    {["10", "50", "100", "500"].map((q) => (
                        <button
                            key={q}
                            onClick={() => setAmount(q)}
                            className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-500 hover:border-slate-500 hover:text-slate-300 transition-colors"
                        >
                            {q}
                        </button>
                    ))}
                </div>
            </div>

            {/* Payout preview */}
            {estimatedPayout !== undefined &&
                amountUnits > 0n &&
                prediction !== null && (
                    <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
                        <div className="flex justify-between text-xs">
                            <span className="text-slate-500">
                                Estimated payout
                            </span>
                            <span className="font-mono font-semibold text-emerald-400">
                                {parseFloat(
                                    formatUnits(estimatedPayout, 6),
                                ).toFixed(2)}{" "}
                                USDC
                            </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600">
                            Based on current pool. Final payout depends on other
                            wagers.
                        </p>
                    </div>
                )}

            {/* CTA */}
            <button
                onClick={handleCTA}
                disabled={!canSubmit}
                className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white transition-all hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
                {step === "approving" && approveIsPending
                    ? "⏳ Approving USDC…"
                    : step === "wagering" && wagerIsPending
                      ? "⏳ Confirming wager…"
                      : needsApproval
                        ? "Step 1: Approve USDC"
                        : "Bet on This Logic →"}
            </button>

            {needsApproval && step === "input" && (
                <p className="text-center text-xs text-slate-600">
                    Two transactions: approve USDC spend, then place wager.
                </p>
            )}
        </div>
    );
}
