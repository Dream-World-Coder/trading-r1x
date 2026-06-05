/**
 * app/page.tsx — Marketplace Listing
 *
 * Production: replace MOCK_TRACES with a TheGraph query indexing TraceRegistered events.
 * For demo: uses static mock data + the one real trace from your pipeline_receipt.json.
 *
 * All data logic and state is unchanged — only visual layer updated.
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
    wagingDeadline: number;
    status: TraceStatus;
    ipfsCid: string;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_TRACES: MockTrace[] = [
    {
        hash: "6545bd6d1bf45d95e010866f9e1b4d86b2a91e8182684ff3666e12a03427c33f",
        asset: "BTC/USDC",
        action: "BUY",
        regime: "NEUTRAL",
        conviction: 0.65,
        rationale:
            "Short-term bearish trend combined with oversold RSI suggests a potential buying opportunity.",
        profitPool: BigInt("1240000000"),
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

const STATUS_CONFIG: Record<
    TraceStatus,
    { label: string; color: string; border: string; bg: string; pulse: boolean }
> = {
    OPEN: {
        label: "Open",
        color: "var(--green)",
        border: "var(--green-border)",
        bg: "var(--green-bg)",
        pulse: true,
    },
    PENDING: {
        label: "Awaiting Resolution",
        color: "var(--amber)",
        border: "var(--amber-border)",
        bg: "var(--amber-bg)",
        pulse: true,
    },
    RESOLVED_WIN: {
        label: "Profitable",
        color: "var(--green)",
        border: "var(--green-border)",
        bg: "var(--green-bg)",
        pulse: false,
    },
    RESOLVED_LOSS: {
        label: "Not Profitable",
        color: "var(--red)",
        border: "var(--red-border)",
        bg: "var(--red-bg)",
        pulse: false,
    },
};

// ─── Trace Card ───────────────────────────────────────────────────────────────

function TraceCard({ trace }: { trace: MockTrace }) {
    const total = trace.profitPool + trace.lossPool;
    const profitPct =
        total > 0n ? Number((trace.profitPool * 100n) / total) : 50;
    const action = ACTION_STYLE[trace.action];
    const status = STATUS_CONFIG[trace.status];
    const isOpen = trace.status === "OPEN";

    return (
        <Link
            href={`/trace/${trace.hash}`}
            className="block card card-hover rounded-sm fade-in"
            style={{ textDecoration: "none" }}
        >
            <div className="p-5">
                {/* Header row */}
                <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex-1 min-w-0">
                        {/* Hash + action badge */}
                        <div className="flex items-center gap-2 mb-1.5">
                            <span
                                className="mono-xs"
                                style={{ color: "var(--ink-5)" }}
                            >
                                {trace.hash.slice(0, 8)}…
                            </span>
                            <span
                                className="badge"
                                style={{
                                    color: action.color,
                                    borderColor: action.border,
                                    background: action.bg,
                                }}
                            >
                                {trace.action}
                            </span>
                        </div>

                        {/* Asset name */}
                        <h3
                            className="text-lg font-semibold mb-1 leading-tight"
                            style={{
                                fontFamily: "var(--font-serif)",
                                color: "var(--ink)",
                            }}
                        >
                            {trace.asset}
                        </h3>

                        {/* Rationale */}
                        <p
                            className="text-sm leading-relaxed line-clamp-2"
                            style={{
                                color: "var(--ink-3)",
                                fontFamily: "var(--font-serif)",
                                fontStyle: "italic",
                            }}
                        >
                            {trace.rationale}
                        </p>
                    </div>

                    {/* Conviction score */}
                    <div className="shrink-0 text-right">
                        <div
                            className="text-2xl font-bold leading-none"
                            style={{
                                fontFamily: "var(--font-mono)",
                                color: "var(--ink)",
                            }}
                        >
                            {(trace.conviction * 100).toFixed(0)}
                            <span
                                className="text-sm font-normal ml-0.5"
                                style={{ color: "var(--ink-4)" }}
                            >
                                %
                            </span>
                        </div>
                        <div className="label mt-0.5">conviction</div>
                    </div>
                </div>

                {/* Pool distribution */}
                <div className="mb-3">
                    <div
                        className="flex justify-between mb-1.5"
                        style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.68rem",
                            color: "var(--ink-4)",
                        }}
                    >
                        <span>↑ {formatUsdc(trace.profitPool)} USDC</span>
                        <span>↓ {formatUsdc(trace.lossPool)} USDC</span>
                    </div>
                    <div
                        className="h-1 w-full rounded-full overflow-hidden"
                        style={{ background: "var(--paper-grid)" }}
                    >
                        <div
                            className="h-full transition-all"
                            style={{
                                width: `${profitPct}%`,
                                background: "var(--green)",
                                opacity: 0.7,
                            }}
                        />
                    </div>
                </div>

                {/* Footer row */}
                <div className="rule pt-3 flex items-center justify-between">
                    {/* Status badge */}
                    <span
                        className="badge"
                        style={{
                            color: status.color,
                            borderColor: status.border,
                            background: status.bg,
                        }}
                    >
                        {status.pulse && (
                            <span
                                className="h-1.5 w-1.5 rounded-full mr-1.5 inline-block pulse"
                                style={{ background: status.color }}
                            />
                        )}
                        {status.label}
                    </span>

                    {/* Meta */}
                    <div
                        className="flex items-center gap-3"
                        style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.67rem",
                            color: "var(--ink-4)",
                        }}
                    >
                        <span>
                            ${formatUsdc(trace.profitPool + trace.lossPool)}{" "}
                            pool
                        </span>
                        {isOpen && (
                            <span style={{ color: "var(--amber)" }}>
                                ⏱ {timeRemaining(trace.wagingDeadline)}
                            </span>
                        )}
                        <span style={{ color: "var(--ink-5)" }}>View →</span>
                    </div>
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

    const totalWagered = MOCK_TRACES.reduce(
        (s, t) => s + t.profitPool + t.lossPool,
        0n,
    );

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
                    {/* Wordmark */}
                    <div className="flex items-center gap-3">
                        <span
                            className="font-bold tracking-tight"
                            style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: "0.85rem",
                                color: "var(--accent)",
                                letterSpacing: "0.02em",
                            }}
                        >
                            TRADING-R1
                        </span>
                        <span
                            className="hidden sm:block"
                            style={{
                                fontFamily: "var(--font-serif)",
                                fontStyle: "italic",
                                fontSize: "0.8rem",
                                color: "var(--ink-4)",
                            }}
                        >
                            Reasoning Trace Market
                        </span>
                    </div>
                    <WalletButton />
                </div>
            </header>

            <main className="mx-auto max-w-5xl px-6 py-10">
                {/* Page header — research paper style */}
                <div
                    className="mb-8 pb-6"
                    style={{ borderBottom: "1px solid var(--paper-rule)" }}
                >
                    <p className="label mb-2">
                        Decentralised Prediction Market · Arc L1
                    </p>
                    <h1
                        className="text-3xl font-bold leading-tight mb-3"
                        style={{ fontFamily: "var(--font-serif)" }}
                    >
                        Bet on AI Reasoning
                    </h1>
                    <p
                        className="max-w-xl text-base leading-relaxed"
                        style={{
                            fontFamily: "var(--font-serif)",
                            fontStyle: "italic",
                            color: "var(--ink-3)",
                        }}
                    >
                        Each entry is an immutable AI reasoning trace — pinned
                        on IPFS, registered on Arc&nbsp;L1. Wager USDC on
                        whether the logic was sound.
                    </p>
                </div>

                {/* Stats row */}
                <div
                    className="grid grid-cols-3 gap-px mb-8 border border-paper-rule overflow-hidden rounded-sm"
                    style={{ borderColor: "var(--paper-rule)" }}
                >
                    {[
                        { label: "Total Traces", value: MOCK_TRACES.length },
                        { label: "Open Markets", value: openCount },
                        {
                            label: "Total Wagered",
                            value: `$${formatUsdc(totalWagered)}`,
                        },
                    ].map(({ label, value }) => (
                        <div
                            key={label}
                            className="px-4 py-4 text-center"
                            style={{
                                background: "var(--paper-card)",
                                borderColor: "var(--paper-rule)",
                            }}
                        >
                            <div
                                className="text-xl font-bold leading-none mb-1"
                                style={{
                                    fontFamily: "var(--font-mono)",
                                    color: "var(--ink)",
                                }}
                            >
                                {value}
                            </div>
                            <div className="label">{label}</div>
                        </div>
                    ))}
                </div>

                {/* Filter tabs */}
                <div className="flex gap-1.5 mb-5">
                    {(["ALL", "OPEN", "RESOLVED"] as FilterTab[]).map((tab) => (
                        <button
                            key={tab}
                            onClick={() => setFilter(tab)}
                            className={`btn-secondary ${filter === tab ? "active" : ""}`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                {/* Cards grid */}
                {filtered.length === 0 ? (
                    <div
                        className="rounded-sm border py-20 text-center"
                        style={{
                            borderStyle: "dashed",
                            borderColor: "var(--paper-rule)",
                        }}
                    >
                        <p className="label">No traces in this filter.</p>
                    </div>
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                        {filtered.map((trace) => (
                            <TraceCard key={trace.hash} trace={trace} />
                        ))}
                    </div>
                )}

                {/* Footer */}
                <p
                    className="mt-10 text-center mono-xs"
                    style={{ color: "var(--ink-5)" }}
                >
                    Production: replace mock data with a TheGraph subgraph
                    indexing{" "}
                    <code style={{ color: "var(--ink-4)" }}>
                        TraceRegistered
                    </code>{" "}
                    events. Contract:{" "}
                    <a
                        href="https://testnet.arcscan.app/address/0xb25b94C6A080e1BAD6DaFc1A00A49821AA431c7c"
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--accent-mid)" }}
                    >
                        0xb25b94…431c7c
                    </a>
                </p>
            </main>
        </div>
    );
}
