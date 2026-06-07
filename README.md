<video src="https://raw.githubusercontent.com/Dream-World-Coder/trading-r1x/main/demo/trading-r1x-demo-subtitled-slowed.mp4" controls width="300px"></video>

# Trading-R1: A Decentralised Prediction Market for AI Reasoning Traces

## What This Is

Most AI trading systems are black boxes. A model makes a decision, executes a trade, and you either trust it or you don't. Trading-R1 inverts this: the AI's **reasoning process** — the structured chain of thought it used to arrive at a decision — is extracted, made immutable, and turned into the primary product. Other users then wager USDC on whether that reasoning was actually correct.

The core insight comes from the Trading-R1 research paper: a reasoning trace has independent value as a verifiable intellectual artifact, separate from whether the trade it describes was ever executed. This project implements that idea as a full-stack Web3 system across four phases, deployed on Circle's Arc L1 blockchain.

---

## The Problem Being Solved

When an AI agent recommends a trade, there is no way to:

1. Verify what logic the model actually used
2. Hold the reasoning accountable after the fact
3. Create a market around the *quality of the thinking*, not just the outcome

Traditional prediction markets bet on outcomes. This system bets on reasoning. The distinction matters: a correct outcome reached via flawed logic is still bad reasoning, and a wrong outcome reached via sound logic is still valuable analysis. By forcing the reasoning into an immutable, content-addressed artifact before the outcome is known, we create a system where the quality of AI thinking can be priced by a market.

---

## System Architecture

```txt
┌─────────────────────────────────────────────────────────────────────┐
│                         TRADING-R1 PIPELINE                         │
│                                                                     │
│  ┌────────────┐    ┌────────────┐    ┌──────────────────────────┐   │
│  │  Phase 1   │    │  Phase 2   │    │        Phase 3           │   │
│  │            │    │            │    │                          │   │
│  │ AI Reasoni-│ ──▶│ IPFS/Irys  │ ──▶│  Arc L1 Smart Contract   │   │
│  │-ng Engine. │    │  Storage   │    │  TradeReasoningMarket    │   │
│  │  (Python)  │    │  Pipeline  │    │      (Solidity)          │   │
│  │            │    │  (Python)  │    │                          │   │
│  └────────────┘    └────────────┘    └──────────────────────────┘   │
│                                                  │                  │
│                                                  ▼                  │
│                              ┌───────────────────────────────────┐  │
│                              │           Phase 4                 │  │
│                              │      Next.js Marketplace          │  │
│                              └───────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```txt
MarketSignal  →  ReasoningTrace JSON  →  SHA-256 hash + IPFS CID  →  Arc L1
     │                   │                        │                      │
price, vol,        structured                content-addressed      on-chain primary
RSI, funding,      chain-of-thought           permanent storage      key + wager pool
sentiment          with schema                on IPFS                settlement
```

<u>Everything downstream of Phase 1 is derived from the same canonical bytes.</u> The hash is the thread that connects the LLM output, the IPFS pin, the on-chain record, and the user-facing marketplace card.

---

## Phase 1: The AI Reasoning Engine (phase1_reasoning_engine.py)

### What it does

Accepts a `MarketSignal` object containing real-time-style financial data — price, 24h change, volume, 30-day annualised volatility, RSI, perpetual funding rate, and a sentiment score — and calls an LLM (Anthropic Claude, or any OpenAI-compatible endpoint) to generate a structured reasoning trace.

### Why schema enforcement matters

A free-form LLM response cannot be hashed, verified, or used as a smart contract key. The entire system depends on the output being deterministic and machine-readable. Phase 1 solves this two ways:

**Prompt engineering**: The system prompt instructs the model to return only a JSON object matching an exact schema, with no markdown fencing, no preamble, and no explanation outside the JSON.

**Pydantic validation**: Even if the model partially complies, the output is parsed and validated against a `ReasoningTrace` Pydantic model. If any required field is missing, has the wrong type, or violates a constraint (e.g. `conviction` must be between 0.0 and 1.0, `reasoning_trace` must have at least 3 steps), the call fails loudly rather than silently producing a malformed artifact.

### The output schema

```json
{
  "schema_version": "1.0.0",
  "trace_id": "<sha256 of the input signal>",
  "asset": "BTC/USDC",
  "timestamp_utc": "2025-01-15T14:32:00+00:00",
  "regime": "HIGH_VOL_UNCERTAIN",
  "reasoning_trace": [
    { "step": 1, "thought": "...", "evidence": "..." },
    { "step": 2, "thought": "...", "evidence": "..." },
    { "step": 3, "thought": "...", "evidence": "..." }
  ],
  "action": "HOLD",
  "conviction": 0.62,
  "rationale_summary": "One-sentence summary for the marketplace card.",
  "suggested_position_size_pct": 0.0,
  "stop_loss_pct": 5.0,
  "take_profit_pct": 8.0
}
```

> [!Note]
> Each step in `reasoning_trace` must cite a specific data point from the input signal as evidence. This forces the model to ground its reasoning in the actual numbers, not generic market commentary.

The `trace_id` is derived deterministically by SHA-256 hashing the canonical serialisation of the input `MarketSignal`. <u>This means the same market conditions always produce the same `trace_id`, making the input traceable even if the JSON is retrieved years later from IPFS.</u>

A `call_llm_mock()` function is provided that returns a realistic hardcoded response, allowing the entire downstream pipeline to be tested without any API key.

---

## Phase 2: The Immutable Storage Pipeline (phase2_storage_pipeline.py)

### What it does

<u>Takes the validated JSON string from Phase 1, hashes it, pins it to IPFS via the Pinata API, and returns a `StorageReceipt` containing the SHA-256 hex digest and the IPFS CID. These two values are what get written to the blockchain.</u>

### Why canonical serialisation is critical

JSON is not a deterministic format. `{"a": 1, "b": 2}` and `{"b": 2, "a": 1}` are semantically identical but produce different hashes. If the hash is going to serve as a trustless on-chain reference, the serialisation rules must be fixed and applied consistently everywhere. 

> ![note]

The pipeline enforces three rules: keys are sorted alphabetically (`sort_keys=True`), there are no extra spaces (`separators=(",", ":")`), and all unicode is normalised to ASCII escapes (`ensure_ascii=True`). These same rules must be applied any time someone wants to independently verify a trace — and because they are simple and standard, anyone can reimplement them in any language.

The hash is computed over these exact bytes. The same bytes are what get uploaded to IPFS. After pinning, the pipeline re-derives the hash and compares it to the receipt before proceeding. If they differ, the function raises an exception rather than writing a mismatched hash to the chain.

### Storage backends

Three backends are provided:

- **`pinata`**: Production. Uses the Pinata API to pin the JSON and returns a real CIDv1. Requires `PINATA_JWT` in the environment.
- **`local`**: Development. Requires a locally running IPFS daemon (`ipfs daemon`) and pins via the local HTTP API on port 5001.
- **`mock`**: Offline testing. No network calls. Constructs a deterministic fake CID from the hash prefix so downstream code can be exercised without any infrastructure.

The `StorageReceipt` dataclass that the function returns carries everything needed for Phase 3: the SHA-256 hex, the CID, the gateway URL, the pin size, and the timestamp.

---

## Phase 3: The Settlement Layer (phase3_TradeReasoningMarket.sol)

### What it does

A Solidity smart contract deployed on Circle's Arc L1 testnet that acts as the prediction market engine. It stores trace registrations, accepts USDC wagers, distributes winnings after resolution, and collects a protocol fee.

### Contract design decisions

**The primary key is a `bytes32` hash, not an auto-incrementing ID.** This is the most important design choice. Using the SHA-256 hash as the key means anyone holding the IPFS CID can independently re-derive the hash, look up the contract, and verify the stored hash matches — without trusting any indexer or database. Sequential IDs would break this property.

**USDC is pulled, not pushed.** Wagers use `safeTransferFrom`, meaning the contract never holds ETH from users. Users must call `approve()` on the USDC contract before placing a wager. This is standard ERC-20 pull payment — it avoids reentrancy issues and is the same pattern used by every major DeFi protocol.

**One wager per address per trace.** The contract stores a `mapping(bytes32 => mapping(address => uint256))` of wager indices. Attempting to place a second wager from the same address reverts with `AlreadyWagered`. This prevents a single actor from splitting a large position into many small wagers to game the pool distribution.

**Custom errors instead of `require` strings.** All failure cases use Solidity custom errors (e.g. `error WagingClosed(bytes32 hash)`). These are cheaper to deploy and cheaper to revert than string-based `require` statements, and they carry typed parameters that off-chain clients can decode precisely.

### The payout formula

```txt
fee = loserPool × 2%
distributable = loserPool − fee
userPayout = userStake + (userStake / totalWinnerPool) × distributable
```

Winners receive their original stake back plus a pro-rata share of the loser pool minus the 2% protocol fee. If nobody is on the losing side (everyone predicted correctly), all stakes are returned in full and no fee is taken — the formula degrades gracefully to a no-op.

The fee accumulates in `protocolFeeBalance` and is only withdrawn by the owner via `withdrawProtocolFees()`. It never leaves the contract automatically.

**`MockERC20.sol`** is a companion contract — a minimal mintable ERC-20 deployed alongside the market on testnet. The deploy script mints 1,000,000 USDC to the deployer address so the system can be fully exercised without needing Circle to issue real testnet tokens.

---

## Phase 4: The Marketplace UI

### Frontend stack

Next.js 14 with the App Router, TypeScript, Tailwind CSS, wagmi v2, and viem v2. The wagmi/viem pairing is version-locked because wagmi v2 was a complete API rewrite — `useReadContract`, `useWriteContract`, and `useWaitForTransactionReceipt` are the v2 hook names and they are not backwards compatible with v1.

### File structure

```txt
frontend/
├── wagmi.config.ts               — Arc chain definition + contract addresses
├── app/
│   ├── layout.tsx                — root layout with IBM Plex Mono font
│   ├── providers.tsx             — WagmiProvider + QueryClientProvider wrapper
│   ├── page.tsx                  — marketplace listing page
│   └── trace/[hash]/page.tsx    — individual trace detail + wager/claim
└── components/
    └── WalletButton.tsx          — shared connect/disconnect button
```

`phase4_TraceMarketplace.tsx` contains the `WagerForm` component: the two-step approve-then-wager flow with a live payout preview that calls `previewPayout()` on the contract as the user types.

### `wagmi.config.ts`

Defines the Arc testnet as a custom chain using viem's `defineChain`, registers the `injected()` (MetaMask) and `walletConnect()` connectors, and exports `CONTRACT_ADDRESSES` as a typed constant so every component imports addresses from one place rather than scattering them in environment variable reads.

### `providers.tsx`

Required by Next.js App Router: a `"use client"` component that wraps the app in both `WagmiProvider` and `QueryClientProvider`. The `QueryClient` is created inside `useState` so it is stable across re-renders but isolated per server request (no cross-user state leakage in SSR).

### `app/page.tsx` — Marketplace listing

Displays all registered traces as cards. Each card shows: the asset and action, a pool distribution bar (profit vs loss USDC), the number of wagers, time remaining, and the resolution status. A filter bar allows switching between ALL, OPEN, and RESOLVED views. In production this page would query a TheGraph subgraph that indexes `TraceRegistered` events; for the hackathon it uses mock data in the same shape.

### `app/trace/[hash]/page.tsx` — Trace detail

Dynamic route. Reads on-chain state via `useReadContract(getTrace)` using the hash from the URL as the lookup key. Fetches the full JSON from IPFS client-side using the CID stored on-chain. Renders the full reasoning chain step-by-step. Conditionally shows either the `WagerForm` (if the market is still open) or the `ClaimButton` (if resolved). The `ClaimButton` component also reads the user's wager via `useReadContract(getUserWager)` and shows whether they won or lost before the claim button appears.

---

## The Pipeline Orchestrator (pipeline_orchestrator.py)

This is the glue script that chains all three backend phases into a single command. It imports `generate_reasoning_trace` from Phase 1 and `process_trace` from Phase 2, then calls `register_trace_on_chain()` which uses `web3.py` to build, sign, and broadcast the `registerTrace()` transaction to Arc L1.

The orchestrator supports four execution modes via CLI flags:

| Flag | Effect |
|---|---|
| *(none)* | Full dry run — mock LLM, mock IPFS, encodes tx but does not broadcast |
| `--live-llm` | Calls the real Anthropic API |
| `--pinata` | Pins to Pinata IPFS instead of mock |
| `--broadcast` | Signs and sends the transaction to Arc L1 |
| `--continuous` | Loops indefinitely, emitting a new trace every 5 minutes |

The `--continuous` flag is specifically designed for hackathon demo purposes: it generates traces for randomly chosen assets on a fixed interval, saves each `pipeline_receipt_NNNN.json`, and continues running even if an individual iteration fails.

Each run produces a `PipelineReceipt` dataclass that captures every layer of the pipeline in one place: the `trace_id`, SHA-256 hash, IPFS CID and URL, Arc L1 transaction hash and block number, contract address, waging deadline, and resolution deadline — all in a single JSON file that the frontend can consume directly.

---

## Contract Testing (TradeReasoningMarket.test.ts)

17 tests across 5 describe blocks using Hardhat's local network and `@nomicfoundation/hardhat-network-helpers` for time manipulation.

| Block | Tests |
|---|---|
| `registerTrace()` | Registers and emits event, reverts on duplicate hash, reverts on zero window |
| `placeWager()` | Profit/loss pools update correctly, deadline enforcement, duplicate wager rejection, min/max amount enforcement, USDC pull verified |
| `resolveTrace()` | Owner can resolve, non-owner reverts, double-resolve reverts |
| `claimWinnings()` | Correct payout math for profit side, correct payout for loss side, losers cannot claim, double-claim reverts, cannot claim before resolution, zero-loser edge case (full refund) |
| `previewPayout()` | Preview return matches actual claim payout |
| `withdrawProtocolFees()` | 2% fee accumulates correctly and is withdrawable by owner |

The payout tests validate the exact USDC amounts using the formula above. For example: Bob stakes 300 USDC on profit, Carol stakes 100 USDC on loss, trace resolves profitable. Fee = 2 USDC, distributable = 98 USDC, Bob's share = 98/1 = 98 USDC, total payout = 398 USDC. The test asserts this exact figure.

---

## Deployment Sequence

For a fresh deployment from zero:

```txt
1.  cp .env.example .env                            # fill credentials
2.  cd contracts && npm install
3.  npx hardhat compile
4.  npx hardhat test                                # all 17 should pass
5.  npx hardhat run scripts/deploy.ts --network arc_testnet
    → writes deployment.json with contract addresses
6.  Copy addresses from deployment.json → .env
7.  pip install anthropic pydantic requests python-dotenv web3
8.  python pipeline_orchestrator.py --live-llm --pinata --broadcast
    → registers the first trace on Arc L1
    → writes pipeline_receipt.json
9.  cd frontend && npm install
10. npm run dev                                     # http://localhost:3000
```

After step 8, the frontend at step 10 will show a live trace card with a real IPFS-pinned JSON and a real on-chain wager pool.

---

## Key Design Principles

**Content-addressability over IDs.** Every reference in the system traces back to the SHA-256 hash of the canonical JSON. No sequential IDs, no UUIDs, no database primary keys. Anyone with the raw JSON can derive the hash independently.

**Verification at every boundary.** Phase 2 re-derives the hash after pinning and fails if they differ. The Solidity contract stores the hash on-chain so users can verify it against the IPFS content. The Pydantic schema in Phase 1 rejects malformed LLM output before it enters the pipeline.

**Mock-first design.** Every external dependency — the LLM API, IPFS, the blockchain — has a mock path that requires zero credentials. The entire pipeline can be exercised offline. This was a deliberate choice for a hackathon codebase: anyone cloning the repo can run `python pipeline_orchestrator.py` immediately and see output.

**Pull payments.** The contract never holds ETH from users and never pushes USDC anywhere automatically. All outflows require an explicit user action (`claimWinnings`). This eliminates an entire class of reentrancy and griefing attacks.

**Gas awareness.** The contract avoids dynamic array iteration in hot paths, uses mappings for O(1) lookups, uses custom errors instead of require strings, and stores wager indices as 1-based integers (reserving 0 as "no wager exists") to avoid a separate `bool exists` storage slot.

---

## What Would Come Next

The hackathon build is a complete, working system. The natural next steps for a production version would be: 

- **Trustless oracle**: Replace `onlyOwner` resolution with a Chainlink Functions callback that queries on-chain price history to verify PnL automatically.
- **TheGraph subgraph**: Index `TraceRegistered`, `WagerPlaced`, and `TraceResolved` events so the frontend can query live data without a centralised backend.
- **Irys (Arweave) fallback**: IPFS content can become unavailable if pinning services drop it. Irys provides permanent, pay-once Arweave storage as a more durable alternative.
- **Multi-step reasoning tournaments**: Instead of single traces, allow a series of traces on the same asset to form a structured debate between multiple AI configurations, with the market pricing each one.
- **Leaderboard**: Track which LLM configurations, prompt strategies, and market regimes produce the highest-conviction correct traces over time — effectively a public benchmark for financial reasoning quality.
