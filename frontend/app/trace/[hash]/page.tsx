/**
 * app/trace/[hash]/page.tsx — Individual Trace Detail + Wager/Claim
 *
 * Fixes vs original:
 *  - ABI Trace struct no longer has sha256Hash / registeredAt (don't exist in contract)
 *  - getUserWager removed (doesn't exist) → uses profitWagers + lossWagers mappings
 *  - WagerForm imported from components
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

// ─── Claim Button ─────────────────────────────────────────────────────────────

function ClaimButton({ traceHash }: { traceHash: `0x${string}` }) {
    const { address } = useAccount();

    // Read user's profit wager
    const { data: profitWager } = useReadContract({
        address: CONTRACT_ADDRESSES.TradeReasoningMarket,
        abi: MARKET_ABI,
        functionName: "profitWagers",
        args: address ? [traceHash, address] : undefined,
        query: { enabled: !!address },
    });

    // Read user's loss wager
    const { data: lossWager } = useReadContract({
        address: CONTRACT_ADDRESSES.TradeReasoningMarket,
        abi: MARKET_ABI,
        functionName: "lossWagers",
        args: address ? [traceHash, address] : undefined,
        query: { enabled: !!address },
    });

    // Read claimed status
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
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
                <p className="text-sm font-semibold text-emerald-400">
                    ✅ Winnings claimed
                </p>
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-slate-700 bg-slate-900 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">
                Your wager
            </p>
            <div className="flex justify-between text-sm">
                <span className="text-slate-400">Amount</span>
                <span className="font-mono text-white">
                    {parseFloat(formatUnits(userStake, 6)).toFixed(2)} USDC
                </span>
            </div>
            <div className="flex justify-between text-sm">
                <span className="text-slate-400">Predicted</span>
                <span
                    className={
                        predictedProfit ? "text-emerald-400" : "text-red-400"
                    }
                >
                    {predictedProfit ? "📈 Profit" : "📉 Loss"}
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
                className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors"
            >
                {isPending ? "⏳ Claiming…" : "Claim Winnings →"}
            </button>
            {claimTxHash && (
                <p className="text-center font-mono text-xs text-slate-500">
                    Tx: {claimTxHash.slice(0, 20)}…
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
                className={`rounded-xl border p-4 text-sm ${
                    open
                        ? "border-indigo-500/30 bg-indigo-500/5 text-indigo-400"
                        : "border-amber-500/30 bg-amber-500/5 text-amber-400"
                }`}
            >
                {open
                    ? `⏳ Wagers open until ${new Date(Number(trace.wagingDeadline) * 1000).toLocaleString()}`
                    : "🔒 Waging closed. Awaiting oracle resolution."}
            </div>
        );
    }
    return (
        <div
            className={`rounded-xl border p-4 text-sm font-semibold ${
                trace.wasProfitable
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                    : "border-red-500/40 bg-red-500/10 text-red-400"
            }`}
        >
            {trace.wasProfitable
                ? "✅ Resolved: Trade was PROFITABLE"
                : "❌ Resolved: Trade was NOT profitable"}
        </div>
    );
}

// ─── IPFS fetch (client-side) ─────────────────────────────────────────────────

function useIpfsTrace(cid: string) {
    const [data, setData] = useState<IpfsTrace | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!cid) return;
        fetch(`https://gateway.pinata.cloud/ipfs/${cid}`)
            .then((r) => r.json())
            .then(setData)
            .catch(() => {
                // Fallback mock so UI renders in dev without Pinata
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
            })
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

    if (chainLoading || ipfsLoading) {
        return (
            <div className="flex min-h-screen items-center justify-center bg-slate-950">
                <div className="space-y-3 text-center">
                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
                    <p className="text-sm text-slate-500">Loading trace…</p>
                </div>
            </div>
        );
    }

    const isWagingOpen =
        trace && !trace.resolved
            ? BigInt(Math.floor(Date.now() / 1000)) < trace.wagingDeadline
            : false;

    const ACTION_COLORS = {
        BUY: "text-emerald-400",
        SELL: "text-red-400",
        HOLD: "text-amber-400",
    };

    return (
        <div className="min-h-screen bg-slate-950 text-white">
            {/* Header */}
            <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                        <Link
                            href="/"
                            className="text-sm text-slate-400 transition-colors hover:text-white"
                        >
                            ← Back
                        </Link>
                        <span className="text-slate-700">|</span>
                        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-xs font-black">
                            R1
                        </div>
                        <span className="font-semibold text-slate-200">
                            Trace Detail
                        </span>
                    </div>
                    <WalletButton />
                </div>
            </header>

            <main className="mx-auto max-w-6xl px-6 py-10">
                {/* Title */}
                <div className="mb-6">
                    <p className="mb-1 font-mono text-xs text-slate-500">
                        {hash.slice(0, 20)}…
                    </p>
                    <h1 className="text-3xl font-black text-white">
                        <span>{ipfsTrace?.asset ?? "—"}</span>
                        {" — "}
                        <span
                            className={
                                ipfsTrace
                                    ? ACTION_COLORS[ipfsTrace.action]
                                    : "text-white"
                            }
                        >
                            {ipfsTrace?.action ?? "—"}
                        </span>
                    </h1>
                    <p className="mt-2 max-w-2xl text-slate-400">
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
                        {/* Metrics */}
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            {[
                                {
                                    label: "Conviction",
                                    value: `${((ipfsTrace?.conviction ?? 0) * 100).toFixed(0)}%`,
                                    color: "text-white",
                                },
                                {
                                    label: "Stop Loss",
                                    value: `-${ipfsTrace?.stop_loss_pct ?? "—"}%`,
                                    color: "text-red-400",
                                },
                                {
                                    label: "Take Profit",
                                    value: `+${ipfsTrace?.take_profit_pct ?? "—"}%`,
                                    color: "text-emerald-400",
                                },
                                {
                                    label: "Regime",
                                    value: (ipfsTrace?.regime ?? "—").replace(
                                        /_/g,
                                        " ",
                                    ),
                                    color: "text-amber-400",
                                },
                            ].map(({ label, value, color }) => (
                                <div
                                    key={label}
                                    className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-center"
                                >
                                    <p className="mb-1 text-xs text-slate-500">
                                        {label}
                                    </p>
                                    <p
                                        className={`truncate text-xl font-bold ${color}`}
                                    >
                                        {value}
                                    </p>
                                </div>
                            ))}
                        </div>

                        {/* Reasoning chain */}
                        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
                            <h2 className="mb-5 text-xs font-semibold uppercase tracking-widest text-slate-500">
                                Reasoning Trace
                            </h2>
                            <div className="space-y-3">
                                {(ipfsTrace?.reasoning_trace ?? []).map(
                                    (step, i, arr) => (
                                        <div
                                            key={step.step}
                                            className="relative pl-8"
                                        >
                                            {i < arr.length - 1 && (
                                                <div className="absolute bottom-0 left-[13px] top-7 w-px bg-slate-700" />
                                            )}
                                            <div className="absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-xs font-bold text-slate-400">
                                                {step.step}
                                            </div>
                                            <div className="rounded-lg border border-slate-700/50 bg-slate-800/40 p-3">
                                                <p className="text-sm leading-relaxed text-slate-300">
                                                    {step.thought}
                                                </p>
                                                <p className="mt-1.5 font-mono text-xs text-cyan-400/80">
                                                    ↳ {step.evidence}
                                                </p>
                                            </div>
                                        </div>
                                    ),
                                )}
                            </div>
                        </div>

                        {/* Provenance */}
                        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-3">
                            <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">
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
                                <div
                                    key={label}
                                    className="flex flex-col gap-0.5"
                                >
                                    <span className="text-xs uppercase tracking-widest text-slate-600">
                                        {label}
                                    </span>
                                    <span className="break-all font-mono text-xs text-slate-400">
                                        {value}
                                    </span>
                                </div>
                            ))}
                            {trace?.ipfsCid && (
                                <a
                                    href={`https://gateway.pinata.cloud/ipfs/${trace.ipfsCid}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex text-xs text-indigo-400 transition-colors hover:text-indigo-300"
                                >
                                    View raw JSON on IPFS ↗
                                </a>
                            )}
                        </div>
                    </div>

                    {/* Right: wager / claim */}
                    <div className="space-y-5">
                        {/* Pool stats */}
                        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
                            <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-500">
                                Pool Breakdown
                            </h2>
                            <div className="mb-3 space-y-2">
                                {[
                                    {
                                        label: "📈 Will Profit",
                                        amount: profitUsdc,
                                        pct: profitPct,
                                        color: "bg-emerald-500",
                                    },
                                    {
                                        label: "📉 Will Lose",
                                        amount: lossUsdc,
                                        pct: 100 - profitPct,
                                        color: "bg-red-500",
                                    },
                                ].map(({ label, amount, pct, color }) => (
                                    <div key={label}>
                                        <div className="mb-1 flex justify-between text-xs text-slate-400">
                                            <span>{label}</span>
                                            <span className="font-mono">
                                                ${amount.toFixed(2)} USDC
                                            </span>
                                        </div>
                                        <div className="h-1.5 w-full rounded-full bg-slate-700">
                                            <div
                                                className={`h-full rounded-full ${color}`}
                                                style={{ width: `${pct}%` }}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-slate-600">
                                Total: ${totalUsdc.toFixed(2)} USDC
                            </p>
                        </div>

                        {/* Claim (resolved traces) */}
                        {trace?.resolved && (
                            <ClaimButton traceHash={traceHash} />
                        )}

                        {/* Wager form (open markets) */}
                        {isWagingOpen && (
                            <div className="rounded-2xl border border-indigo-500/30 bg-slate-900 p-5">
                                <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-500">
                                    Place Wager
                                </h2>
                                <WagerForm traceHash={traceHash} />
                            </div>
                        )}

                        {/* How it works */}
                        <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-1.5 text-xs text-slate-500">
                            <p className="font-semibold text-slate-400">
                                How payouts work
                            </p>
                            <p>
                                Winners receive their stake back plus a pro-rata
                                share of the loser pool.
                            </p>
                            <p>
                                A 2% protocol fee is deducted from the loser
                                pool before distribution.
                            </p>
                            <p>
                                If no one loses, all wagers are returned in
                                full.
                            </p>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
