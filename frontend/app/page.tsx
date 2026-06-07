/**
 * app/page.tsx — Marketplace Listing
 *
 * Fetches traces from /api/traces (MongoDB) instead of MOCK_TRACES.
 * All UI components are unchanged.
 *
 * On-chain pool values (profitPool / lossPool) are returned as "0" from the
 * API because they live on Arc L1, not in MongoDB. Two options to enrich:
 *   A. Read them in the API route using viem's publicClient.readContract()
 *      (adds ~200 ms latency but keeps the page fully server-driven).
 *   B. Read them client-side with wagmi's useReadContract() per card
 *      (better for live updates, more complex).
 * For now, the bar shows a 50/50 split when both pools are zero.
 */

"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import WalletButton from "@/components/WalletButton";
import type { ApiTrace } from "./api/traces/route";

// ─── Types ────────────────────────────────────────────────────────────────────

// TraceStatus is derived client-side from status + wagingDeadline
type TraceStatus = "OPEN" | "PENDING" | "RESOLVED_WIN" | "RESOLVED_LOSS";
type FilterTab = "ALL" | "OPEN" | "RESOLVED";

interface DisplayTrace extends ApiTrace {
    derivedStatus: TraceStatus;
    profitPoolBig: bigint;
    lossPoolBig: bigint;
}

// ─── Status derivation ────────────────────────────────────────────────────────

function deriveStatus(trace: ApiTrace): TraceStatus {
    const now = Math.floor(Date.now() / 1000);
    if (trace.status === "resolved") return "RESOLVED_WIN"; // wasProfitable not in receipt yet
    if (trace.wagingDeadline > now) return "OPEN";
    return "PENDING";
}

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

// ─── Action / status style config (unchanged) ─────────────────────────────────

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

// ─── Trace Card (unchanged structure) ────────────────────────────────────────

function TraceCard({ trace }: { trace: DisplayTrace }) {
    const total = trace.profitPoolBig + trace.lossPoolBig;
    const profitPct =
        total > 0n ? Number((trace.profitPoolBig * 100n) / total) : 50;
    const action = ACTION_STYLE[trace.action];
    const status = STATUS_CONFIG[trace.derivedStatus];
    const isOpen = trace.derivedStatus === "OPEN";

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
                            {trace.dataSource === "live" && (
                                <span
                                    className="badge"
                                    style={{
                                        color: "var(--accent-mid)",
                                        borderColor: "var(--accent-mid)",
                                        background: "transparent",
                                        opacity: 0.7,
                                    }}
                                >
                                    live
                                </span>
                            )}
                        </div>

                        <h3
                            className="text-lg font-semibold mb-1 leading-tight"
                            style={{
                                fontFamily: "var(--font-serif)",
                                color: "var(--ink)",
                            }}
                        >
                            {trace.asset}
                        </h3>

                        <p
                            className="text-sm leading-relaxed line-clamp-2"
                            style={{
                                color: "var(--ink-3)",
                                fontFamily: "var(--font-serif)",
                                fontStyle: "italic",
                            }}
                        >
                            {/* rationale comes from IPFS — fetched in detail page */}
                            {trace.rationale ||
                                "Open trace detail to view full reasoning chain."}
                        </p>
                    </div>

                    {/* Conviction */}
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

                {/* Pool bar */}
                <div className="mb-3">
                    <div
                        className="flex justify-between mb-1.5"
                        style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.68rem",
                            color: "var(--ink-4)",
                        }}
                    >
                        <span>↑ {formatUsdc(trace.profitPoolBig)} USDC</span>
                        <span>↓ {formatUsdc(trace.lossPoolBig)} USDC</span>
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

                {/* Footer */}
                <div className="rule pt-3 flex items-center justify-between">
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

                    <div
                        className="flex items-center gap-3"
                        style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.67rem",
                            color: "var(--ink-4)",
                        }}
                    >
                        <span>
                            $
                            {formatUsdc(
                                trace.profitPoolBig + trace.lossPoolBig,
                            )}{" "}
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

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function CardSkeleton() {
    return (
        <div className="card rounded-sm p-5 animate-pulse">
            <div className="flex justify-between mb-4">
                <div className="space-y-2 flex-1">
                    <div
                        className="h-3 w-24 rounded"
                        style={{ background: "var(--paper-grid)" }}
                    />
                    <div
                        className="h-5 w-32 rounded"
                        style={{ background: "var(--paper-grid)" }}
                    />
                    <div
                        className="h-3 w-full rounded"
                        style={{ background: "var(--paper-grid)" }}
                    />
                </div>
                <div
                    className="h-8 w-12 rounded ml-4"
                    style={{ background: "var(--paper-grid)" }}
                />
            </div>
            <div
                className="h-1 w-full rounded"
                style={{ background: "var(--paper-grid)" }}
            />
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketplacePage() {
    const [filter, setFilter] = useState<FilterTab>("ALL");
    const [traces, setTraces] = useState<DisplayTrace[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // ── Fetch from /api/traces on mount ───────────────────────────────
    useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                setLoading(true);
                setError(null);

                const res = await fetch("/api/traces");
                if (!res.ok) throw new Error(`API returned ${res.status}`);

                const { traces: raw }: { traces: ApiTrace[] } =
                    await res.json();

                if (!cancelled) {
                    setTraces(
                        raw.map((t) => ({
                            ...t,
                            derivedStatus: deriveStatus(t),
                            profitPoolBig: BigInt(t.profitPool),
                            lossPoolBig: BigInt(t.lossPool),
                        })),
                    );
                }
            } catch (err) {
                if (!cancelled) {
                    console.error("[MarketplacePage] fetch error:", err);
                    setError(
                        "Could not load traces. Check that MONGODB_URI is set and the API route is reachable.",
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, []);

    // ── Derived counts ────────────────────────────────────────────────
    const filtered = traces.filter((t) => {
        if (filter === "OPEN")
            return t.derivedStatus === "OPEN" || t.derivedStatus === "PENDING";
        if (filter === "RESOLVED")
            return (
                t.derivedStatus === "RESOLVED_WIN" ||
                t.derivedStatus === "RESOLVED_LOSS"
            );
        return true;
    });

    const openCount = traces.filter(
        (t) => t.derivedStatus === "OPEN" || t.derivedStatus === "PENDING",
    ).length;
    const totalWagered = traces.reduce(
        (s, t) => s + t.profitPoolBig + t.lossPoolBig,
        0n,
    );

    // ── Render ────────────────────────────────────────────────────────
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
                {/* Page header */}
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
                        {
                            label: "Total Traces",
                            value: loading ? "—" : traces.length,
                        },
                        {
                            label: "Open Markets",
                            value: loading ? "—" : openCount,
                        },
                        {
                            label: "Total Wagered",
                            value: loading
                                ? "—"
                                : `$${formatUsdc(totalWagered)}`,
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

                {/* Error state */}
                {error && (
                    <div
                        className="rounded-sm border p-5 mb-5"
                        style={{
                            borderColor: "var(--red-border)",
                            background: "var(--red-bg)",
                            color: "var(--red)",
                        }}
                    >
                        <p className="mono-xs font-semibold mb-1">
                            Failed to load traces
                        </p>
                        <p
                            className="text-sm"
                            style={{ color: "var(--ink-3)" }}
                        >
                            {error}
                        </p>
                    </div>
                )}

                {/* Cards grid */}
                {loading ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                        {[1, 2, 3, 4].map((i) => (
                            <CardSkeleton key={i} />
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <div
                        className="rounded-sm border py-20 text-center"
                        style={{
                            borderStyle: "dashed",
                            borderColor: "var(--paper-rule)",
                        }}
                    >
                        <p className="label">
                            {error
                                ? "Could not load traces."
                                : "No traces in this filter."}
                        </p>
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
                    Data from MongoDB · receipts collection · sorted by{" "}
                    <code style={{ color: "var(--ink-4)" }}>
                        created_at desc
                    </code>
                    . Contract:{" "}
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
