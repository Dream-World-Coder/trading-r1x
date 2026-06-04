/**
 * Trading-R1 Marketplace — Phase 4 UI
 * =====================================
 * A Next.js + wagmi/viem + Tailwind component for the reasoning trace
 * prediction market. Displays the full trace and lets users wager USDC.
 *
 * Install deps:
 *   npm install wagmi viem @tanstack/react-query
 *
 * Wrap your app in:
 *   <WagmiProvider config={wagmiConfig}>
 *     <QueryClientProvider client={queryClient}>
 *       ...
 *     </QueryClientProvider>
 *   </WagmiProvider>
 */

"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useWriteContract,
  useReadContract,
  useWaitForTransactionReceipt,
  useBalance,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { parseUnits, formatUnits, type Address } from "viem";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ReasoningStep {
  step: number;
  thought: string;
  evidence: string;
}

interface ReasoningTrace {
  schema_version: string;
  trace_id: string;
  asset: string;
  timestamp_utc: string;
  regime: "RISK_ON" | "RISK_OFF" | "NEUTRAL" | "HIGH_VOL_UNCERTAIN";
  reasoning_trace: ReasoningStep[];
  action: "BUY" | "SELL" | "HOLD";
  conviction: number;
  rationale_summary: string;
  suggested_position_size_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
}

interface StorageReceipt {
  sha256_hex: string;
  ipfs_cid: string;
  ipfs_url: string;
}

// ─── Contract Config ───────────────────────────────────────────────────────────

const CONTRACT_ADDRESS = "0xYOUR_DEPLOYED_CONTRACT_ADDRESS" as Address;
const USDC_ADDRESS = "0xYOUR_USDC_ADDRESS_ON_ARC" as Address;

// Minimal ABI — only the functions we call from the UI
const MARKET_ABI = [
  {
    name: "placeWager",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "_hash", type: "bytes32" },
      { name: "_predictProfit", type: "bool" },
      { name: "_amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "getTrace",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "_hash", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "sha256Hash", type: "bytes32" },
          { name: "ipfsCid", type: "string" },
          { name: "creator", type: "address" },
          { name: "registeredAt", type: "uint256" },
          { name: "wagingDeadline", type: "uint256" },
          { name: "resolutionDeadline", type: "uint256" },
          { name: "resolved", type: "bool" },
          { name: "wasProfitable", type: "bool" },
          { name: "profitPool", type: "uint256" },
          { name: "lossPool", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "previewPayout",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "_hash", type: "bytes32" },
      { name: "_predictProfit", type: "bool" },
      { name: "_amount", type: "uint256" },
    ],
    outputs: [{ name: "estimatedPayout", type: "uint256" }],
  },
  {
    name: "claimWinnings",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_hash", type: "bytes32" }],
    outputs: [],
  },
] as const;

const ERC20_APPROVE_ABI = [
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

// ─── Mock Data (replace with IPFS fetch in production) ────────────────────────

const MOCK_TRACE: ReasoningTrace = {
  schema_version: "1.0.0",
  trace_id: "a3f9d2c1e4b5f8a7d6c3b2a1e9f8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1",
  asset: "BTC/USDC",
  timestamp_utc: "2025-01-15T14:32:00+00:00",
  regime: "HIGH_VOL_UNCERTAIN",
  reasoning_trace: [
    {
      step: 1,
      thought:
        "RSI at 38.5 is approaching oversold territory but has not confirmed a reversal. Selling pressure remains elevated without clear capitulation signals.",
      evidence: "RSI(14) = 38.5; historical BTC bounces occur sub-30",
    },
    {
      step: 2,
      thought:
        "Negative funding rate of -0.0002 indicates short-side dominance in perpetuals. Sustained negative funding often precedes squeeze events, but timing is highly uncertain.",
      evidence: "Funding rate = -0.0002; shorts paying longs",
    },
    {
      step: 3,
      thought:
        "Sentiment at -0.35 is moderately bearish. Combined with 30d volatility of 62%, the risk-reward for a directional position is unfavourable given the conviction level.",
      evidence: "Sentiment = -0.35; Vol = 62%; 24h Δ = -3.2%",
    },
    {
      step: 4,
      thought:
        "Low-volume drops are less reliable trend signals. Waiting for volume confirmation before taking a position preserves optionality.",
      evidence: "24h volume = $28.4B (est. below 30d avg)",
    },
  ],
  action: "HOLD",
  conviction: 0.62,
  rationale_summary:
    "Elevated volatility and mixed signals across momentum, funding, and sentiment favour capital preservation over a directional position.",
  suggested_position_size_pct: 0.0,
  stop_loss_pct: 5.0,
  take_profit_pct: 8.0,
};

const MOCK_RECEIPT: StorageReceipt = {
  sha256_hex: "a3f9d2c1e4b5f8a7d6c3b2a1e9f8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1",
  ipfs_cid: "bafybeiga3f9d2c1e4b5f8a7d6c3b2a1e9f8d7c6b5a4f",
  ipfs_url:
    "https://gateway.pinata.cloud/ipfs/bafybeiga3f9d2c1e4b5f8a7d6c3b2a1",
};

// ─── Sub-components ────────────────────────────────────────────────────────────

const REGIME_CONFIG = {
  RISK_ON: {
    label: "Risk On",
    color: "text-emerald-400",
    bg: "bg-emerald-400/10 border-emerald-400/30",
  },
  RISK_OFF: {
    label: "Risk Off",
    color: "text-red-400",
    bg: "bg-red-400/10 border-red-400/30",
  },
  NEUTRAL: {
    label: "Neutral",
    color: "text-slate-400",
    bg: "bg-slate-400/10 border-slate-400/30",
  },
  HIGH_VOL_UNCERTAIN: {
    label: "High Vol / Uncertain",
    color: "text-amber-400",
    bg: "bg-amber-400/10 border-amber-400/30",
  },
};

const ACTION_CONFIG = {
  BUY: {
    label: "BUY",
    color: "text-emerald-400",
    bg: "bg-emerald-500",
    border: "border-emerald-500",
  },
  SELL: {
    label: "SELL",
    color: "text-red-400",
    bg: "bg-red-500",
    border: "border-red-500",
  },
  HOLD: {
    label: "HOLD",
    color: "text-amber-400",
    bg: "bg-amber-500",
    border: "border-amber-500",
  },
};

function ReasoningChain({ steps }: { steps: ReasoningStep[] }) {
  return (
    <div className="space-y-3">
      {steps.map((step, i) => (
        <div key={step.step} className="relative pl-8 group">
          {/* Step connector line */}
          {i < steps.length - 1 && (
            <div className="absolute left-[13px] top-7 bottom-0 w-px bg-slate-700" />
          )}

          {/* Step number badge */}
          <div className="absolute left-0 top-1 flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 bg-slate-800 text-xs font-mono font-bold text-slate-400">
            {step.step}
          </div>

          <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-3 transition-colors group-hover:border-slate-600">
            <p className="text-sm text-slate-300 leading-relaxed">
              {step.thought}
            </p>
            <div className="mt-2 flex items-start gap-1.5">
              <span className="mt-px text-xs text-slate-500 shrink-0">↳</span>
              <span className="font-mono text-xs text-cyan-400/80">
                {step.evidence}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function HashDisplay({ hash, label }: { hash: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-slate-500 uppercase tracking-widest">
        {label}
      </span>
      <button
        onClick={copy}
        className="group flex items-center gap-2 rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-left hover:border-slate-500 transition-colors"
      >
        <span className="font-mono text-xs text-slate-400 truncate">
          {hash}
        </span>
        <span className="ml-auto shrink-0 text-xs text-slate-600 group-hover:text-slate-400 transition-colors">
          {copied ? "✓" : "copy"}
        </span>
      </button>
    </div>
  );
}

// ─── Wallet Connect Button ─────────────────────────────────────────────────────

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address, token: USDC_ADDRESS });

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-3">
        <div className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5">
          <span className="text-xs text-slate-400">
            {balance
              ? `${parseFloat(formatUnits(balance.value, 6)).toFixed(2)} USDC`
              : "—"}
          </span>
        </div>
        <button
          onClick={() => disconnect()}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-1.5 text-sm text-slate-300 hover:border-red-500/50 hover:text-red-400 transition-colors"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400" />
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

// ─── Wager Form ───────────────────────────────────────────────────────────────

function WagerForm({ traceHash }: { traceHash: `0x${string}` }) {
  const { address, isConnected } = useAccount();
  const [prediction, setPrediction] = useState<boolean | null>(null);
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"input" | "approve" | "wager" | "done">(
    "input",
  );

  // USDC approval
  const { writeContract: approve, data: approveTxHash } = useWriteContract();
  const { isSuccess: approveSuccess } = useWaitForTransactionReceipt({
    hash: approveTxHash,
  });

  // Wager transaction
  const {
    writeContract: placeWager,
    data: wagerTxHash,
    isPending: wagerPending,
  } = useWriteContract();
  const { isSuccess: wagerSuccess } = useWaitForTransactionReceipt({
    hash: wagerTxHash,
  });

  // Current allowance
  const { data: allowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_APPROVE_ABI,
    functionName: "allowance",
    args: address ? [address, CONTRACT_ADDRESS] : undefined,
    query: { enabled: !!address },
  });

  // Payout preview (live from contract)
  const amountUnits = amount ? parseUnits(amount, 6) : 0n;
  const { data: estimatedPayout } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: MARKET_ABI,
    functionName: "previewPayout",
    args:
      prediction !== null ? [traceHash, prediction, amountUnits] : undefined,
    query: { enabled: !!amount && prediction !== null && amountUnits > 0n },
  });

  const handleApprove = () => {
    if (!amount) return;
    approve({
      address: USDC_ADDRESS,
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [CONTRACT_ADDRESS, parseUnits(amount, 6)],
    });
    setStep("approve");
  };

  const handleWager = () => {
    if (prediction === null || !amount) return;
    placeWager({
      address: CONTRACT_ADDRESS,
      abi: MARKET_ABI,
      functionName: "placeWager",
      args: [traceHash, prediction, parseUnits(amount, 6)],
    });
    setStep("wager");
  };

  useEffect(() => {
    if (wagerSuccess) setStep("done");
  }, [wagerSuccess]);

  const needsApproval =
    allowance !== undefined && amountUnits > 0n && allowance < amountUnits;

  if (!isConnected) {
    return (
      <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center">
        <p className="text-sm text-slate-500">
          Connect your wallet to wager USDC on this trace.
        </p>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-6 text-center space-y-2">
        <div className="text-2xl">✅</div>
        <p className="font-semibold text-emerald-400">
          Wager placed successfully
        </p>
        <p className="text-xs text-slate-500">
          Tx:{" "}
          <a
            href={`https://explorer.arc.testnet/tx/${wagerTxHash}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-indigo-400 hover:underline"
          >
            {wagerTxHash?.slice(0, 20)}…
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Prediction toggle */}
      <div>
        <label className="mb-2 block text-xs uppercase tracking-widest text-slate-500">
          Your prediction
        </label>
        <div className="grid grid-cols-2 gap-2">
          {[
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
          ].map(({ value, label, active }) => (
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
        <label className="mb-2 block text-xs uppercase tracking-widest text-slate-500">
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
        {/* Quick amounts */}
        <div className="mt-2 flex gap-2">
          {["10", "50", "100", "500"].map((q) => (
            <button
              key={q}
              onClick={() => setAmount(q)}
              className="rounded px-2 py-0.5 text-xs text-slate-500 border border-slate-700 hover:border-slate-500 hover:text-slate-300 transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
      </div>

      {/* Payout preview */}
      {estimatedPayout && amount && prediction !== null && (
        <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
          <div className="flex justify-between text-xs text-slate-500">
            <span>Estimated payout</span>
            <span className="font-mono text-emerald-400 font-semibold">
              {parseFloat(formatUnits(estimatedPayout, 6)).toFixed(2)} USDC
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600">
            Based on current pool distribution. Final payout depends on other
            wagers.
          </p>
        </div>
      )}

      {/* CTA Button */}
      <button
        onClick={needsApproval ? handleApprove : handleWager}
        disabled={
          !amount ||
          prediction === null ||
          wagerPending ||
          (step === "approve" && !approveSuccess)
        }
        className="w-full rounded-lg bg-indigo-600 py-3 font-semibold text-white transition-all hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {step === "approve" && !approveSuccess
          ? "⏳ Approving USDC…"
          : needsApproval
            ? "Step 1: Approve USDC"
            : wagerPending
              ? "⏳ Confirming…"
              : "Bet on This Logic →"}
      </button>

      {needsApproval && (
        <p className="text-center text-xs text-slate-600">
          Two transactions required: approve USDC spend, then place wager.
        </p>
      )}
    </div>
  );
}

// ─── Main Page Component ───────────────────────────────────────────────────────

export default function TraceMarketplacePage() {
  const [trace] = useState<ReasoningTrace>(MOCK_TRACE);
  const [receipt] = useState<StorageReceipt>(MOCK_RECEIPT);

  // In production: fetch from IPFS by CID
  // const { data: traceData } = useSWR(receipt.ipfs_url, fetcher);

  const traceHash = `0x${receipt.sha256_hex}` as `0x${string}`;
  const regime = REGIME_CONFIG[trace.regime];
  const action = ACTION_CONFIG[trace.action];

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-black">
              R1
            </div>
            <span className="font-semibold text-slate-200">
              Trading-R1 Market
            </span>
          </div>
          <WalletButton />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {/* Page Title */}
        <div className="mb-8">
          <p className="text-xs uppercase tracking-widest text-slate-500 mb-2">
            Reasoning Trace #{receipt.sha256_hex.slice(0, 8)}…
          </p>
          <h1 className="text-3xl font-bold text-white">
            {trace.asset} — {action.label}
          </h1>
          <p className="mt-2 text-slate-400 max-w-2xl">
            {trace.rationale_summary}
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Left column: full trace */}
          <div className="lg:col-span-2 space-y-6">
            {/* Metrics bar */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* Action */}
              <div
                className={`rounded-xl border ${action.border} bg-slate-900 p-4 text-center`}
              >
                <p className="text-xs text-slate-500 mb-1">Action</p>
                <p className={`text-2xl font-black ${action.color}`}>
                  {action.label}
                </p>
              </div>
              {/* Conviction */}
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-center">
                <p className="text-xs text-slate-500 mb-1">Conviction</p>
                <p className="text-2xl font-black text-white">
                  {(trace.conviction * 100).toFixed(0)}%
                </p>
              </div>
              {/* Stop Loss */}
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-center">
                <p className="text-xs text-slate-500 mb-1">Stop Loss</p>
                <p className="text-2xl font-black text-red-400">
                  -{trace.stop_loss_pct}%
                </p>
              </div>
              {/* Take Profit */}
              <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-center">
                <p className="text-xs text-slate-500 mb-1">Take Profit</p>
                <p className="text-2xl font-black text-emerald-400">
                  +{trace.take_profit_pct}%
                </p>
              </div>
            </div>

            {/* Regime badge */}
            <div
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 ${regime.bg}`}
            >
              <span
                className={`text-xs font-semibold uppercase tracking-widest ${regime.color}`}
              >
                {regime.label} Regime
              </span>
            </div>

            {/* Reasoning chain */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="mb-6 text-sm font-semibold uppercase tracking-widest text-slate-400">
                Reasoning Trace
              </h2>
              <ReasoningChain steps={trace.reasoning_trace} />
            </div>

            {/* Provenance / hashes */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
                On-Chain Provenance
              </h2>
              <HashDisplay
                hash={receipt.sha256_hex}
                label="SHA-256 (primary key)"
              />
              <HashDisplay hash={receipt.ipfs_cid} label="IPFS CID" />
              <a
                href={receipt.ipfs_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                View raw JSON on IPFS ↗
              </a>
            </div>
          </div>

          {/* Right column: wager panel */}
          <div className="space-y-6">
            {/* Pool stats */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">
                Current Pools
              </h2>
              {/* Mock pool data — replace with useReadContract getTrace() */}
              <div className="space-y-3">
                {[
                  {
                    label: "Will Profit",
                    amount: "2,840",
                    color: "bg-emerald-500",
                  },
                  { label: "Will Lose", amount: "1,120", color: "bg-red-500" },
                ].map(({ label, amount: amt, color }) => (
                  <div key={label}>
                    <div className="mb-1 flex justify-between text-xs text-slate-400">
                      <span>{label}</span>
                      <span className="font-mono">{amt} USDC</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-700">
                      <div
                        className={`h-1.5 rounded-full ${color}`}
                        style={{
                          width: label === "Will Profit" ? "72%" : "28%",
                        }}
                      />
                    </div>
                  </div>
                ))}
                <p className="pt-1 text-xs text-slate-600">
                  Total pool: 3,960 USDC · 14 wagers
                </p>
              </div>
            </div>

            {/* Wager form */}
            <div className="rounded-2xl border border-indigo-500/30 bg-slate-900 p-6">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-slate-400">
                Bet on This Logic
              </h2>
              <WagerForm traceHash={traceHash} />
            </div>

            {/* Info card */}
            <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-400">
                How it works
              </p>
              <ul className="space-y-1 text-xs text-slate-500">
                <li>1. The AI reasoning trace is pinned to IPFS.</li>
                <li>2. Its SHA-256 hash is registered on Arc L1.</li>
                <li>3. Wager USDC on whether the trade was profitable.</li>
                <li>4. After resolution, winners split the loser pool.</li>
                <li>5. A 2% protocol fee funds development.</li>
              </ul>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
