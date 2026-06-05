/**
 * app/page.tsx — Marketplace Listing
 *
 * Production: replace MOCK_TRACES with a TheGraph query indexing TraceRegistered events.
 * For demo: uses static mock data + the one real trace from your pipeline_receipt.json.
 */

"use client";

import { useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import WalletButton from "@/components/WalletButton";

// ─── Types ────────────────────────────────────────────────────────────────────

type TraceStatus = "OPEN" | "PENDING" | "RESOLVED_WIN" | "RESOLVED_LOSS";
type FilterTab = "ALL" | "OPEN" | "RESOLVED";

interface MockTrace {
    hash: string;
    asset: string;
    action: "BUY" | "SELL" | "HOLD";
    regime: string;
    conviction: number;
    rationale: string;
    profitPool: bigint;
    lossPool: bigint;
    wagingDeadline: number; // unix seconds
    status: TraceStatus;
    ipfsCid: string;
}

// ─── Mock data ────────────────────────────────────────────────────────────────
// Replace with live TheGraph query: subgraph.theGraph.query(TRACES_QUERY)
// The first entry uses your real deployed trace from pipeline_receipt.json

const MOCK_TRACES: MockTrace[] = [
    {
        hash: "6545bd6d1bf45d95e010866f9e1b4d86b2a91e8182684ff3666e12a03427c33f",
        asset: "BTC/USDC",
        action: "BUY",
        regime: "NEUTRAL",
        conviction: 0.65,
        rationale:
            "Short-term bearish trend combined with oversold RSI suggests a potential buying opportunity.",
        profitPool: BigInt("1240000000"), // 1240 USDC (6 decimals)
        lossPool: BigInt("380000000"),
        wagingDeadline: Math.floor(Date.now() / 1000) + 3600 * 18,
        status: "OPEN",
        ipfsCid: "bafkreif744otaxvo724cc6wvux7ckcbquweltqnwmyn24s5qldglxiadmy",
    },
    {
        hash: "a3f9d2c1e4b5f8a7d6c3b2a1e9f8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0",
        asset: "ETH/USDC",
        action: "HOLD",
        regime: "HIGH_VOL_UNCERTAIN",
        conviction: 0.58,
        rationale:
            "Elevated volatility and mixed signals across momentum, funding, and sentiment favour capital preservation.",
        profitPool: BigInt("890000000"),
        lossPool: BigInt("1100000000"),
        wagingDeadline: Math.floor(Date.now() / 1000) - 3600 * 2,
        status: "PENDING",
        ipfsCid: "bafkreiexamplecideth",
    },
    {
        hash: "b7e2f1a0d9c8b7a6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2",
        asset: "SOL/USDC",
        action: "BUY",
        regime: "RISK_ON",
        conviction: 0.78,
        rationale:
            "Strong momentum with positive funding and bullish sentiment provides favourable risk/reward for a long position.",
        profitPool: BigInt("3200000000"),
        lossPool: BigInt("600000000"),
        wagingDeadline: Math.floor(Date.now() / 1000) - 3600 * 48,
        status: "RESOLVED_WIN",
        ipfsCid: "bafkreiexamplecidsol",
    },
    {
        hash: "c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3",
        asset: "ARB/USDC",
        action: "SELL",
        regime: "RISK_OFF",
        conviction: 0.71,
        rationale:
            "Weak volume confirmation and negative sentiment signal downside risk warrants a short position.",
        profitPool: BigInt("540000000"),
        lossPool: BigInt("2100000000"),
        wagingDeadline: Math.floor(Date.now() / 1000) - 3600 * 72,
        status: "RESOLVED_LOSS",
        ipfsCid: "bafkreiexamplecidarb",
    },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUsdc(raw: bigint) {
    return parseFloat(formatUnits(raw, 6)).toFixed(0);
}

function timeRemaining(deadline: number): string {
    const diff = deadline - Math.floor(Date.now() / 1000);
    if (diff <= 0) return "Closed";
    const h = Math.floor(diff / 3600);
    const m = Math.floor((diff % 3600) / 60);
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return `${h}h ${m}m`;
}

const ACTION_COLORS = {
    BUY: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
    SELL: "text-red-400 border-red-500/40 bg-red-500/10",
    HOLD: "text-amber-400 border-amber-500/40 bg-amber-500/10",
};

const STATUS_CONFIG: Record<
    TraceStatus,
    { label: string; dot: string; badge: string }
> = {
    OPEN: {
        label: "Open",
        dot: "bg-emerald-400 animate-pulse",
        badge: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
    },
    PENDING: {
        label: "Awaiting Resolution",
        dot: "bg-amber-400 animate-pulse",
        badge: "text-amber-400 border-amber-500/30 bg-amber-500/5",
    },
    RESOLVED_WIN: {
        label: "Profitable ✓",
        dot: "bg-slate-500",
        badge: "text-emerald-300 border-emerald-500/20 bg-emerald-500/5",
    },
    RESOLVED_LOSS: {
        label: "Not Profitable",
        dot: "bg-slate-500",
        badge: "text-red-400 border-red-500/20 bg-red-500/5",
    },
};

// ─── Trace Card ───────────────────────────────────────────────────────────────

function TraceCard({ trace }: { trace: MockTrace }) {
    const total = trace.profitPool + trace.lossPool;
    const profitPct =
        total > 0n ? Number((trace.profitPool * 100n) / total) : 50;
    const action = ACTION_COLORS[trace.action];
    const status = STATUS_CONFIG[trace.status];
    const isOpen = trace.status === "OPEN";

    return (
        <Link
            href={`/trace/${trace.hash}`}
            className="group block rounded-2xl border border-slate-800 bg-slate-900 p-5 transition-all duration-200 hover:border-slate-600 hover:bg-slate-800/80"
        >
            {/* Header */}
            <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-slate-500">
                            {trace.hash.slice(0, 8)}…
                        </span>
                        <span
                            className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${action}`}
                        >
                            {trace.action}
                        </span>
                    </div>
                    <h3 className="text-lg font-bold text-white">
                        {trace.asset}
                    </h3>
                    <p className="mt-1 text-xs text-slate-400 line-clamp-2 leading-relaxed">
                        {trace.rationale}
                    </p>
                </div>
                <div className="shrink-0 text-right">
                    <div className="text-xl font-black text-white">
                        {(trace.conviction * 100).toFixed(0)}%
                    </div>
                    <div className="text-xs text-slate-500">conviction</div>
                </div>
            </div>

            {/* Pool bar */}
            <div className="mb-3">
                <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>📈 {formatUsdc(trace.profitPool)} USDC</span>
                    <span>📉 {formatUsdc(trace.lossPool)} USDC</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700">
                    <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${profitPct}%` }}
                    />
                </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between">
                <div
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${status.badge}`}
                >
                    <span
                        className={`h-1.5 w-1.5 rounded-full ${status.dot}`}
                    />
                    {status.label}
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                    <span>
                        Pool: ${formatUsdc(trace.profitPool + trace.lossPool)}{" "}
                        USDC
                    </span>
                    {isOpen && (
                        <span className="font-mono text-amber-400">
                            ⏱ {timeRemaining(trace.wagingDeadline)}
                        </span>
                    )}
                    <span className="text-slate-600 group-hover:text-slate-400 transition-colors">
                        View →
                    </span>
                </div>
            </div>
        </Link>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
    const [filter, setFilter] = useState<FilterTab>("ALL");

    const filtered = MOCK_TRACES.filter((t) => {
        if (filter === "OPEN")
            return t.status === "OPEN" || t.status === "PENDING";
        if (filter === "RESOLVED")
            return t.status === "RESOLVED_WIN" || t.status === "RESOLVED_LOSS";
        return true;
    });

    const openCount = MOCK_TRACES.filter(
        (t) => t.status === "OPEN" || t.status === "PENDING",
    ).length;

    return (
        <div className="min-h-screen bg-slate-950 text-white">
            {/* Header */}
            <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
                <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black">
                            R1
                        </div>
                        <div>
                            <span className="font-bold text-white">
                                Trading-R1
                            </span>
                            <span className="ml-2 text-xs text-slate-500">
                                Prediction Market
                            </span>
                        </div>
                    </div>
                    <WalletButton />
                </div>
            </header>

            <main className="mx-auto max-w-6xl px-6 py-10">
                {/* Hero */}
                <div className="mb-8">
                    <h1 className="text-3xl font-black text-white">
                        Bet on AI Reasoning
                    </h1>
                    <p className="mt-2 max-w-xl text-slate-400">
                        Each card is an immutable AI reasoning trace, pinned on
                        IPFS and registered on Arc L1. Wager USDC on whether the
                        logic was sound.
                    </p>
                </div>

                {/* Stats bar */}
                <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-3">
                    {[
                        { label: "Total Traces", value: MOCK_TRACES.length },
                        { label: "Open Markets", value: openCount },
                        {
                            label: "Total Wagered",
                            value:
                                "$" +
                                formatUsdc(
                                    MOCK_TRACES.reduce(
                                        (s, t) => s + t.profitPool + t.lossPool,
                                        0n,
                                    ),
                                ) +
                                " USDC",
                        },
                    ].map(({ label, value }) => (
                        <div
                            key={label}
                            className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-center"
                        >
                            <div className="text-xl font-black text-white">
                                {value}
                            </div>
                            <div className="text-xs text-slate-500">
                                {label}
                            </div>
                        </div>
                    ))}
                </div>

                {/* Filter tabs */}
                <div className="mb-6 flex gap-2">
                    {(["ALL", "OPEN", "RESOLVED"] as FilterTab[]).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setFilter(tab)}
                            className={`rounded-lg border px-4 py-1.5 text-sm font-semibold transition-all ${
                                filter === tab
                                    ? "border-indigo-500 bg-indigo-500/20 text-indigo-400"
                                    : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500"
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Cards grid */}
                {filtered.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-700 py-20 text-center">
                        <p className="text-slate-500">
                            No traces in this filter.
                        </p>
                    </div>
                ) : (
                    <div className="grid gap-4 sm:grid-cols-2">
                        {filtered.map((trace) => (
                            <TraceCard key={trace.hash} trace={trace} />
                        ))}
                    </div>
                )}

                {/* Footer note */}
                <p className="mt-10 text-center text-xs text-slate-600">
                    Production: replace mock data with a TheGraph subgraph
                    indexing{" "}
                    <code className="text-slate-500">TraceRegistered</code>{" "}
                    events. Contract:{" "}
                    <a
                        href="https://testnet.arcscan.app/address/0xb25b94C6A080e1BAD6DaFc1A00A49821AA431c7c"
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-500 hover:text-indigo-400"
                    >
                        0xb25b94…431c7c
                    </a>
                </p>
            </main>
        </div>
    );
}
