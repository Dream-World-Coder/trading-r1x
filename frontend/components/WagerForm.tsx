/**
 * components/WagerForm.tsx
 * Two-step approve → placeWager flow with live payout preview.
 * Hook logic is completely unchanged — only visual layer updated.
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
    const [prediction, setPrediction] = useState<boolean | null>(null);
    const [amount, setAmount] = useState("");
    const [step, setStep] = useState<Step>("input");

    // ── Read current allowance ────────────────────────────────────────────────
    const { data: allowance, refetch: refetchAllowance } = useReadContract({
        address: CONTRACT_ADDRESSES.USDC,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: address
            ? [address, CONTRACT_ADDRESSES.TradeReasoningMarket]
            : undefined,
        query: { enabled: !!address },
    });

    // ── Live payout preview ───────────────────────────────────────────────────
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

    // ── Approve USDC ──────────────────────────────────────────────────────────
    const {
        writeContract: approve,
        data: approveTxHash,
        isPending: approveIsPending,
        reset: resetApprove,
    } = useWriteContract();

    const { isSuccess: approveSuccess } = useWaitForTransactionReceipt({
        hash: approveTxHash,
    });

    useEffect(() => {
        if (approveSuccess) {
            refetchAllowance();
            setStep("input");
        }
    }, [approveSuccess, refetchAllowance]);

    // ── Place wager ───────────────────────────────────────────────────────────
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

    // ── Derived state ─────────────────────────────────────────────────────────
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

    // ── Not connected ─────────────────────────────────────────────────────────
    if (!isConnected) {
        return (
            <div
                className="rounded-sm border p-6 text-center"
                style={{
                    borderStyle: "dashed",
                    borderColor: "var(--paper-rule)",
                    background: "var(--paper-warm)",
                }}
            >
                <p className="mono-xs" style={{ color: "var(--ink-4)" }}>
                    Connect your wallet to wager USDC on this trace.
                </p>
            </div>
        );
    }

    // ── Done ──────────────────────────────────────────────────────────────────
    if (step === "done") {
        return (
            <div
                className="rounded-sm border p-6 text-center space-y-2 fade-in"
                style={{
                    borderColor: "var(--green-border)",
                    background: "var(--green-bg)",
                }}
            >
                <div className="text-xl">✓</div>
                <p
                    className="font-semibold text-sm"
                    style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--green)",
                    }}
                >
                    Wager confirmed
                </p>
                {wagerTxHash && (
                    <a
                        href={`https://testnet.arcscan.app/tx/${wagerTxHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mono-xs block"
                        style={{ color: "var(--accent-mid)" }}
                    >
                        {wagerTxHash.slice(0, 22)}… ↗
                    </a>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Prediction toggle */}
            <div>
                <p className="label mb-2">Your prediction</p>
                <div className="grid grid-cols-2 gap-2">
                    {(
                        [
                            {
                                value: true,
                                label: "Will Profit",
                                icon: "↑",
                                activeStyle: {
                                    borderColor: "var(--green-border)",
                                    background: "var(--green-bg)",
                                    color: "var(--green)",
                                },
                            },
                            {
                                value: false,
                                label: "Will Lose",
                                icon: "↓",
                                activeStyle: {
                                    borderColor: "var(--red-border)",
                                    background: "var(--red-bg)",
                                    color: "var(--red)",
                                },
                            },
                        ] as const
                    ).map(({ value, label, icon, activeStyle }) => (
                        <button
                            key={String(value)}
                            onClick={() => setPrediction(value)}
                            className="rounded-sm border px-3 py-2.5 text-sm font-medium transition-all text-left"
                            style={
                                prediction === value
                                    ? {
                                          ...activeStyle,
                                          fontFamily: "var(--font-mono)",
                                          fontSize: "0.75rem",
                                      }
                                    : {
                                          borderColor: "var(--paper-rule)",
                                          background: "var(--paper-warm)",
                                          color: "var(--ink-3)",
                                          fontFamily: "var(--font-mono)",
                                          fontSize: "0.75rem",
                                      }
                            }
                        >
                            <span
                                className="block text-base leading-none mb-0.5"
                                style={{ fontFamily: "var(--font-serif)" }}
                            >
                                {icon}
                            </span>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Amount input */}
            <div>
                <p className="label mb-2">Wager amount</p>
                <div className="relative">
                    <input
                        type="number"
                        min="1"
                        max="10000"
                        placeholder="10"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="input-base pr-16"
                    />
                    <span
                        className="absolute right-3 top-1/2 -translate-y-1/2 mono-xs font-semibold"
                        style={{ color: "var(--ink-4)" }}
                    >
                        USDC
                    </span>
                </div>
                {/* Quick amounts */}
                <div className="mt-2 flex gap-1.5">
                    {["10", "50", "100", "500"].map((q) => (
                        <button
                            key={q}
                            onClick={() => setAmount(q)}
                            className="rounded-sm border px-2 py-0.5 mono-xs transition-colors"
                            style={{
                                borderColor: "var(--paper-rule)",
                                color: "var(--ink-4)",
                            }}
                            onMouseEnter={(e) => {
                                (
                                    e.currentTarget as HTMLElement
                                ).style.borderColor = "var(--ink-3)";
                                (e.currentTarget as HTMLElement).style.color =
                                    "var(--ink-2)";
                            }}
                            onMouseLeave={(e) => {
                                (
                                    e.currentTarget as HTMLElement
                                ).style.borderColor = "var(--paper-rule)";
                                (e.currentTarget as HTMLElement).style.color =
                                    "var(--ink-4)";
                            }}
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
                    <div
                        className="rounded-sm border p-3 fade-in"
                        style={{
                            borderColor: "var(--accent-light)",
                            background: "var(--accent-light)",
                        }}
                    >
                        <div className="flex justify-between items-baseline">
                            <span className="label">Est. payout</span>
                            <span
                                className="mono-sm font-semibold"
                                style={{ color: "var(--accent)" }}
                            >
                                {parseFloat(
                                    formatUnits(estimatedPayout, 6),
                                ).toFixed(2)}{" "}
                                USDC
                            </span>
                        </div>
                        <p
                            className="mono-xs mt-1"
                            style={{ color: "var(--ink-4)" }}
                        >
                            Based on current pool. Final payout depends on other
                            wagers.
                        </p>
                    </div>
                )}

            {/* CTA */}
            <button
                onClick={handleCTA}
                disabled={!canSubmit}
                className="btn-primary w-full"
                style={{ letterSpacing: "0.06em" }}
            >
                {step === "approving" && approveIsPending
                    ? "Approving USDC…"
                    : step === "wagering" && wagerIsPending
                      ? "Confirming wager…"
                      : needsApproval
                        ? "Step 1 — Approve USDC"
                        : "Place Wager →"}
            </button>

            {needsApproval && step === "input" && (
                <p
                    className="text-center mono-xs"
                    style={{ color: "var(--ink-5)" }}
                >
                    Two transactions required: approve USDC spend, then place
                    wager.
                </p>
            )}
        </div>
    );
}
