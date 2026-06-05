/**
 * app/trace/[hash]/page.tsx — Individual Trace Detail + Wager/Claim
 *
 * Fixes vs original:
 *  - ABI Trace struct no longer has sha256Hash / registeredAt (don't exist in contract)
 *  - getUserWager removed (doesn't exist) → uses profitWagers + lossWagers mappings
 *  - WagerForm imported from components
 *
 * All hook logic is completely unchanged — only visual layer updated.
 */

"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import {
    useAccount,
    useReadContract,
    useWriteContract,
    useWaitForTransactionReceipt,
} from "wagmi";
import { formatUnits } from "viem";
import WalletButton from "@/components/WalletButton";
import { WagerForm } from "@/components/WagerForm";
import { MARKET_ABI, OnChainTrace } from "@/lib/abi";
import { CONTRACT_ADDRESSES } from "@/wagmi.config";

// ─── IPFS Trace shape ─────────────────────────────────────────────────────────

interface IpfsTrace {
    asset: string;
    action: "BUY" | "SELL" | "HOLD";
    regime: string;
    conviction: number;
    rationale_summary: string;
    reasoning_trace: Array<{ step: number; thought: string; evidence: string }>;
    stop_loss_pct: number;
    take_profit_pct: number;
    timestamp_utc: string;
}

// ─── Action config ────────────────────────────────────────────────────────────

const ACTION_STYLE: Record<
    "BUY" | "SELL" | "HOLD",
    { color: string; border: string; bg: string }
> = {
    BUY: {
        color: "var(--green)",
        border: "var(--green-border)",
        bg: "var(--green-bg)",
    },
    SELL: {
        color: "var(--red)",
        border: "var(--red-border)",
        bg: "var(--red-bg)",
    },
    HOLD: {
        color: "var(--amber)",
        border: "var(--amber-border)",
        bg: "var(--amber-bg)",
    },
};

// ─── Claim Button ─────────────────────────────────────────────────────────────

function ClaimButton({ traceHash }: { traceHash: `0x${string}` }) {
    const { address } = useAccount();

    const { data: profitWager } = useReadContract({
        address: CONTRACT_ADDRESSES.TradeReasoningMarket,
        abi: MARKET_ABI,
        functionName: "profitWagers",
        args: address ? [traceHash, address] : undefined,
        query: { enabled: !!address },
    });

    const { data: lossWager } = useReadContract({
        address: CONTRACT_ADDRESSES.TradeReasoningMarket,
        abi: MARKET_ABI,
        functionName: "lossWagers",
        args: address ? [traceHash, address] : undefined,
        query: { enabled: !!address },
    });

    const { data: claimed } = useReadContract({
        address: CONTRACT_ADDRESSES.TradeReasoningMarket,
        abi: MARKET_ABI,
        functionName: "hasClaimed",
        args: address ? [traceHash, address] : undefined,
        query: { enabled: !!address },
    });

    const {
        writeContract: claim,
        data: claimTxHash,
        isPending,
    } = useWriteContract();

    const { isSuccess } = useWaitForTransactionReceipt({ hash: claimTxHash });

    const userStake =
        (profitWager ?? 0n) > 0n ? profitWager! : (lossWager ?? 0n);
    const predictedProfit = (profitWager ?? 0n) > 0n;

    if (!address || userStake === 0n) return null;

    if (claimed || isSuccess) {
        return (
            <div
                className="rounded-sm border p-4 text-center"
                style={{
                    borderColor: "var(--green-border)",
                    background: "var(--green-bg)",
                }}
            >
                <p
                    className="text-sm font-medium"
                    style={{
                        fontFamily: "var(--font-mono)",
                        color: "var(--green)",
                    }}
                >
                    ✓ Winnings claimed
                </p>
            </div>
        );
    }

    return (
        <div
            className="rounded-sm border p-4 space-y-3"
            style={{
                borderColor: "var(--paper-rule)",
                background: "var(--paper-card)",
            }}
        >
            <p className="label">Your wager</p>
            <div
                className="flex justify-between text-sm"
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}
            >
                <span style={{ color: "var(--ink-3)" }}>Amount</span>
                <span style={{ color: "var(--ink)" }}>
                    {parseFloat(formatUnits(userStake, 6)).toFixed(2)} USDC
                </span>
            </div>
            <div
                className="flex justify-between text-sm"
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}
            >
                <span style={{ color: "var(--ink-3)" }}>Predicted</span>
                <span
                    style={{
                        color: predictedProfit ? "var(--green)" : "var(--red)",
                    }}
                >
                    {predictedProfit ? "↑ Profit" : "↓ Loss"}
                </span>
            </div>
            <button
                onClick={() =>
                    claim({
                        address: CONTRACT_ADDRESSES.TradeReasoningMarket,
                        abi: MARKET_ABI,
                        functionName: "claimWinnings",
                        args: [traceHash],
                    })
                }
                disabled={isPending}
                className="btn-primary w-full"
                style={{
                    background: "var(--green)",
                    borderColor: "var(--green)",
                }}
            >
                {isPending ? "Claiming…" : "Claim Winnings →"}
            </button>
            {claimTxHash && (
                <p
                    className="text-center mono-xs"
                    style={{ color: "var(--ink-4)" }}
                >
                    Tx: {claimTxHash.slice(0, 22)}…
                </p>
            )}
        </div>
    );
}

// ─── Resolution Banner ────────────────────────────────────────────────────────

function ResolutionBanner({ trace }: { trace: OnChainTrace }) {
    if (!trace.resolved) {
        const now = BigInt(Math.floor(Date.now() / 1000));
        const open = now < trace.wagingDeadline;
        return (
            <div
                className="rounded-sm border p-3 mono-xs"
                style={{
                    borderColor: open
                        ? "var(--accent-light)"
                        : "var(--amber-border)",
                    background: open
                        ? "var(--accent-light)"
                        : "var(--amber-bg)",
                    color: open ? "var(--accent)" : "var(--amber)",
                }}
            >
                {open
                    ? `Wagers open until ${new Date(Number(trace.wagingDeadline) * 1000).toLocaleString()}`
                    : "Waging closed — awaiting oracle resolution."}
            </div>
        );
    }
    return (
        <div
            className="rounded-sm border p-3 mono-xs font-semibold"
            style={{
                borderColor: trace.wasProfitable
                    ? "var(--green-border)"
                    : "var(--red-border)",
                background: trace.wasProfitable
                    ? "var(--green-bg)"
                    : "var(--red-bg)",
                color: trace.wasProfitable ? "var(--green)" : "var(--red)",
            }}
        >
            {trace.wasProfitable
                ? "Resolved — Trade was PROFITABLE"
                : "Resolved — Trade was NOT profitable"}
        </div>
    );
}

// ─── IPFS fetch (client-side) ─────────────────────────────────────────────────

function useIpfsTrace(cid: string) {
    const [data, setData] = useState<IpfsTrace | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadMock = () => {
            setData({
                asset: "BTC/USDC",
                action: "BUY",
                regime: "NEUTRAL",
                conviction: 0.65,
                rationale_summary:
                    "Oversold RSI and negative funding present a buying opportunity with acceptable risk/reward.",
                reasoning_trace: [
                    {
                        step: 1,
                        thought:
                            "Price dropped 3.21% over 24h — bearish short-term but not a breakdown.",
                        evidence: "24h Change: -3.21%",
                    },
                    {
                        step: 2,
                        thought:
                            "RSI at 38.5 is approaching oversold. Historically BTC bounces near 30.",
                        evidence: "RSI(14) = 38.5",
                    },
                    {
                        step: 3,
                        thought:
                            "Negative funding means shorts are dominant — squeeze risk is elevated.",
                        evidence: "Funding rate = -0.0002",
                    },
                ],
                stop_loss_pct: 4.2,
                take_profit_pct: 8.1,
                timestamp_utc: new Date().toISOString(),
            });
            setLoading(false);
        };

        if (!cid) {
            loadMock();
            return;
        }

        setLoading(true);
        fetch(`https://gateway.pinata.cloud/ipfs/${cid}`)
            .then(async (r) => {
                if (!r.ok) throw new Error("HTTP error");
                return r.json();
            })
            .then(setData)
            .catch(() => loadMock())
            .finally(() => setLoading(false));
    }, [cid]);

    return { data, loading };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TracePage({
    params,
}: {
    params: Promise<{ hash: string }>;
}) {
    const { hash } = use(params);
    const traceHash = `0x${hash}` as `0x${string}`;

    const { data: onChainRaw, isLoading: chainLoading } = useReadContract({
        address: CONTRACT_ADDRESSES.TradeReasoningMarket,
        abi: MARKET_ABI,
        functionName: "getTrace",
        args: [traceHash],
    });

    const trace = onChainRaw as OnChainTrace | undefined;
    const { data: ipfsTrace, loading: ipfsLoading } = useIpfsTrace(
        trace?.ipfsCid ?? "",
    );

    const profitUsdc = trace ? parseFloat(formatUnits(trace.profitPool, 6)) : 0;
    const lossUsdc = trace ? parseFloat(formatUnits(trace.lossPool, 6)) : 0;
    const totalUsdc = profitUsdc + lossUsdc;
    const profitPct =
        totalUsdc > 0 ? Math.round((profitUsdc / totalUsdc) * 100) : 50;

    // Loading state
    if (chainLoading || ipfsLoading) {
        return (
            <div
                className="flex min-h-screen items-center justify-center"
                style={{ background: "var(--paper)" }}
            >
                <div className="space-y-4 text-center">
                    <div
                        className="mx-auto h-6 w-6 rounded-full border-2 animate-spin"
                        style={{
                            borderColor: "var(--paper-rule)",
                            borderTopColor: "var(--accent)",
                        }}
                    />
                    <p className="label">Loading trace…</p>
                </div>
            </div>
        );
    }

    const isWagingOpen =
        trace && !trace.resolved
            ? BigInt(Math.floor(Date.now() / 1000)) < trace.wagingDeadline
            : false;

    const actionStyle = ipfsTrace ? ACTION_STYLE[ipfsTrace.action] : null;

    return (
        <div className="min-h-screen" style={{ background: "var(--paper)" }}>
            {/* Header */}
            <header
                className="sticky top-0 z-50 border-b"
                style={{
                    borderColor: "var(--paper-rule)",
                    background: "rgba(248,246,241,0.92)",
                    backdropFilter: "blur(12px)",
                }}
            >
                <div className="mx-auto max-w-5xl px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/"
                            className="mono-xs transition-colors"
                            style={{ color: "var(--ink-4)" }}
                            onMouseEnter={(e) =>
                                ((e.currentTarget as HTMLElement).style.color =
                                    "var(--accent)")
                            }
                            onMouseLeave={(e) =>
                                ((e.currentTarget as HTMLElement).style.color =
                                    "var(--ink-4)")
                            }
                        >
                            ← Back
                        </Link>
                        <span style={{ color: "var(--paper-rule)" }}>|</span>
                        <span
                            className="font-bold"
                            style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: "0.8rem",
                                color: "var(--accent)",
                            }}
                        >
                            TRADING-R1
                        </span>
                        <span
                            className="hidden sm:block"
                            style={{
                                fontFamily: "var(--font-serif)",
                                fontStyle: "italic",
                                fontSize: "0.78rem",
                                color: "var(--ink-4)",
                            }}
                        >
                            Trace Detail
                        </span>
                    </div>
                    <WalletButton />
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-6 py-10">
                {/* Page title */}
                <div
                    className="mb-6 pb-6"
                    style={{ borderBottom: "1px solid var(--paper-rule)" }}
                >
                    <p className="label mb-2">{hash.slice(0, 20)}…</p>
                    <h1
                        className="text-3xl font-bold leading-tight mb-2"
                        style={{ fontFamily: "var(--font-serif)" }}
                    >
                        <span>{ipfsTrace?.asset ?? "—"}</span>
                        {" — "}
                        <span style={{ color: actionStyle?.color }}>
                            {ipfsTrace?.action ?? "—"}
                        </span>
                    </h1>
                    <p
                        className="max-w-2xl text-base leading-relaxed"
                        style={{
                            fontFamily: "var(--font-serif)",
                            fontStyle: "italic",
                            color: "var(--ink-3)",
                        }}
                    >
                        {ipfsTrace?.rationale_summary}
                    </p>
                </div>

                {/* Resolution banner */}
                {trace && (
                    <div className="mb-6">
                        <ResolutionBanner trace={trace} />
                    </div>
                )}

                <div className="grid gap-8 lg:grid-cols-3">
                    {/* Left: reasoning + provenance */}
                    <div className="space-y-6 lg:col-span-2">
                        {/* Metrics grid */}
                        <div
                            className="grid grid-cols-2 sm:grid-cols-4 border overflow-hidden rounded-sm"
                            style={{ borderColor: "var(--paper-rule)" }}
                        >
                            {[
                                {
                                    label: "Conviction",
                                    value: `${((ipfsTrace?.conviction ?? 0) * 100).toFixed(0)}%`,
                                    color: "var(--ink)",
                                },
                                {
                                    label: "Stop Loss",
                                    value: `-${ipfsTrace?.stop_loss_pct ?? "—"}%`,
                                    color: "var(--red)",
                                },
                                {
                                    label: "Take Profit",
                                    value: `+${ipfsTrace?.take_profit_pct ?? "—"}%`,
                                    color: "var(--green)",
                                },
                                {
                                    label: "Regime",
                                    value: (ipfsTrace?.regime ?? "—").replace(
                                        /_/g,
                                        " ",
                                    ),
                                    color: "var(--amber)",
                                },
                            ].map(({ label, value, color }) => (
                                <div
                                    key={label}
                                    className="px-4 py-4 text-center border-r last:border-r-0"
                                    style={{
                                        borderColor: "var(--paper-rule)",
                                        background: "var(--paper-card)",
                                    }}
                                >
                                    <p className="label mb-1">{label}</p>
                                    <p
                                        className="text-xl font-bold truncate leading-none"
                                        style={{
                                            fontFamily: "var(--font-mono)",
                                            color,
                                        }}
                                    >
                                        {value}
                                    </p>
                                </div>
                            ))}
                        </div>

                        {/* Reasoning chain — the main artifact */}
                        <div className="card rounded-sm p-6">
                            <h2
                                className="text-xs font-semibold mb-5 pb-3"
                                style={{
                                    fontFamily: "var(--font-mono)",
                                    letterSpacing: "0.1em",
                                    textTransform: "uppercase",
                                    color: "var(--ink-4)",
                                    borderBottom: "1px solid var(--paper-rule)",
                                }}
                            >
                                Reasoning Trace
                            </h2>
                            <div className="space-y-4">
                                {(ipfsTrace?.reasoning_trace ?? []).map(
                                    (step, i, arr) => (
                                        <div
                                            key={step.step}
                                            className="relative pl-8"
                                        >
                                            {/* Connector line */}
                                            {i < arr.length - 1 && (
                                                <div
                                                    className="absolute bottom-0 left-[11px] top-6 w-px"
                                                    style={{
                                                        background:
                                                            "var(--paper-rule)",
                                                    }}
                                                />
                                            )}
                                            {/* Step number */}
                                            <div
                                                className="absolute left-0 top-0.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold border"
                                                style={{
                                                    fontFamily:
                                                        "var(--font-mono)",
                                                    borderColor:
                                                        "var(--paper-rule)",
                                                    background:
                                                        "var(--paper-warm)",
                                                    color: "var(--ink-3)",
                                                }}
                                            >
                                                {step.step}
                                            </div>
                                            {/* Thought bubble */}
                                            <div
                                                className="rounded-sm border p-3"
                                                style={{
                                                    borderColor:
                                                        "var(--paper-rule)",
                                                    background:
                                                        "var(--paper-warm)",
                                                }}
                                            >
                                                <p
                                                    className="text-sm leading-relaxed mb-2"
                                                    style={{
                                                        fontFamily:
                                                            "var(--font-serif)",
                                                        color: "var(--ink-2)",
                                                    }}
                                                >
                                                    {step.thought}
                                                </p>
                                                <p
                                                    className="mono-xs"
                                                    style={{
                                                        color: "var(--accent-mid)",
                                                    }}
                                                >
                                                    ↳ {step.evidence}
                                                </p>
                                            </div>
                                        </div>
                                    ),
                                )}
                            </div>
                        </div>

                        {/* Provenance */}
                        <div className="card rounded-sm p-6 space-y-4">
                            <h2
                                className="text-xs font-semibold pb-3"
                                style={{
                                    fontFamily: "var(--font-mono)",
                                    letterSpacing: "0.1em",
                                    textTransform: "uppercase",
                                    color: "var(--ink-4)",
                                    borderBottom: "1px solid var(--paper-rule)",
                                }}
                            >
                                On-Chain Provenance
                            </h2>
                            {[
                                { label: "SHA-256 Hash", value: hash },
                                {
                                    label: "IPFS CID",
                                    value: trace?.ipfsCid ?? "—",
                                },
                                {
                                    label: "Creator",
                                    value: trace?.creator ?? "—",
                                },
                                {
                                    label: "Waging Deadline",
                                    value: trace
                                        ? new Date(
                                              Number(trace.wagingDeadline) *
                                                  1000,
                                          ).toLocaleString()
                                        : "—",
                                },
                            ].map(({ label, value }) => (
                                <div key={label}>
                                    <p className="label mb-0.5">{label}</p>
                                    <p
                                        className="mono-xs break-all"
                                        style={{ color: "var(--ink-2)" }}
                                    >
                                        {value}
                                    </p>
                                </div>
                            ))}
                            {trace?.ipfsCid && (
                                <a
                                    href={`https://gateway.pinata.cloud/ipfs/${trace.ipfsCid}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mono-xs inline-flex transition-colors"
                                    style={{ color: "var(--accent-mid)" }}
                                >
                                    View raw JSON on IPFS ↗
                                </a>
                            )}
                        </div>
                    </div>

                    {/* Right column */}
                    <div className="space-y-5">
                        {/* Pool breakdown */}
                        <div className="card rounded-sm p-5">
                            <h2
                                className="text-xs font-semibold mb-4 pb-3"
                                style={{
                                    fontFamily: "var(--font-mono)",
                                    letterSpacing: "0.1em",
                                    textTransform: "uppercase",
                                    color: "var(--ink-4)",
                                    borderBottom: "1px solid var(--paper-rule)",
                                }}
                            >
                                Pool Breakdown
                            </h2>
                            <div className="space-y-3 mb-3">
                                {[
                                    {
                                        label: "↑ Will Profit",
                                        amount: profitUsdc,
                                        pct: profitPct,
                                        color: "var(--green)",
                                    },
                                    {
                                        label: "↓ Will Lose",
                                        amount: lossUsdc,
                                        pct: 100 - profitPct,
                                        color: "var(--red)",
                                    },
                                ].map(({ label, amount, pct, color }) => (
                                    <div key={label}>
                                        <div
                                            className="flex justify-between mb-1"
                                            style={{
                                                fontFamily: "var(--font-mono)",
                                                fontSize: "0.72rem",
                                                color: "var(--ink-3)",
                                            }}
                                        >
                                            <span>{label}</span>
                                            <span>${amount.toFixed(2)}</span>
                                        </div>
                                        <div
                                            className="h-1 w-full rounded-full overflow-hidden"
                                            style={{
                                                background: "var(--paper-grid)",
                                            }}
                                        >
                                            <div
                                                className="h-full"
                                                style={{
                                                    width: `${pct}%`,
                                                    background: color,
                                                    opacity: 0.7,
                                                }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p
                                className="mono-xs"
                                style={{ color: "var(--ink-5)" }}
                            >
                                Total: ${totalUsdc.toFixed(2)} USDC
                            </p>
                        </div>

                        {/* Claim (resolved) */}
                        {trace?.resolved && (
                            <ClaimButton traceHash={traceHash} />
                        )}

                        {/* Wager form (open) */}
                        {isWagingOpen && (
                            <div
                                className="card rounded-sm p-5"
                                style={{ borderColor: "var(--accent-mid)" }}
                            >
                                <h2
                                    className="text-xs font-semibold mb-4 pb-3"
                                    style={{
                                        fontFamily: "var(--font-mono)",
                                        letterSpacing: "0.1em",
                                        textTransform: "uppercase",
                                        color: "var(--ink-4)",
                                        borderBottom:
                                            "1px solid var(--paper-rule)",
                                    }}
                                >
                                    Place Wager
                                </h2>
                                <WagerForm traceHash={traceHash} />
                            </div>
                        )}

                        {/* How payouts work */}
                        <div
                            className="rounded-sm border p-4 space-y-1.5"
                            style={{
                                borderColor: "var(--paper-rule)",
                                background: "var(--paper-warm)",
                            }}
                        >
                            <p
                                className="text-xs font-semibold mb-2"
                                style={{
                                    fontFamily: "var(--font-mono)",
                                    color: "var(--ink-3)",
                                    letterSpacing: "0.06em",
                                    textTransform: "uppercase",
                                }}
                            >
                                How payouts work
                            </p>
                            {[
                                "Winners receive their stake back plus a pro-rata share of the loser pool.",
                                "A 2% protocol fee is deducted from the loser pool before distribution.",
                                "If no one loses, all wagers are returned in full.",
                            ].map((text, i) => (
                                <p
                                    key={i}
                                    className="mono-xs"
                                    style={{ color: "var(--ink-4)" }}
                                >
                                    {text}
                                </p>
                            ))}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
