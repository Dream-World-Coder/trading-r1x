# Trading-R1 — Reasoning Trace Prediction Market

> *The AI's thought process is the product. Wager on whether the logic holds.*

Built for the **Agora Agents Hackathon** (Canteen × Circle). Based on the Trading-R1 research concept: instead of trading on an AI's final decision, users bet USDC on whether the AI's **structured reasoning trace** was profitable.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         TRADING-R1 PIPELINE                         │
│                                                                     │
│  ┌────────────┐    ┌────────────┐    ┌──────────────────────────┐  │
│  │  Phase 1   │    │  Phase 2   │    │        Phase 3           │  │
│  │            │    │            │    │                          │  │
│  │ AI Reasoning│──▶│ IPFS/Irys │──▶│  Arc L1 Smart Contract   │  │
│  │   Engine   │    │  Storage   │    │  TradeReasoningMarket    │  │
│  │  (Python)  │    │  Pipeline  │    │      (Solidity)          │  │
│  │            │    │  (Python)  │    │                          │  │
│  │ MarketSignal│    │  SHA-256   │    │  registerTrace()         │  │
│  │     ▼      │    │  hash +    │    │  placeWager()            │  │
│  │ LLM Call   │    │  IPFS CID  │    │  resolveTrace()          │  │
│  │     ▼      │    │            │    │  claimWinnings()         │  │
│  │ JSON Schema│    │            │    │                          │  │
│  └────────────┘    └────────────┘    └──────────────────────────┘  │
│                                                  │                  │
│                                                  ▼                  │
│                              ┌───────────────────────────────────┐  │
│                              │           Phase 4                 │  │
│                              │      Next.js Marketplace          │  │
│                              │   • Browse open trace markets     │  │
│                              │   • Connect wallet (wagmi/viem)   │  │
│                              │   • Wager USDC                    │  │
│                              │   • Claim winnings                │  │
│                              └───────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
MarketSignal (price, vol, RSI, sentiment)
    │
    ▼ [Phase 1 — phase1_reasoning_engine.py]
ReasoningTrace JSON {asset, regime, reasoning_trace[], action, conviction, …}
    │
    ├─► SHA-256(canonical_json) = hash_hex
    │
    ▼ [Phase 2 — phase2_storage_pipeline.py]
IPFS pin → CID
    │
    ▼ [Phase 3 — TradeReasoningMarket.sol]
registerTrace(bytes32 hash, string cid) → on-chain
    │
    ├─► placeWager(hash, predictProfit, amount)  ← users call this
    ├─► resolveTrace(hash, wasProfitable)         ← oracle resolves
    └─► claimWinnings(hash)                       ← winners claim USDC
```

---

## Repository Structure

```
trading_r1/
│
├── phase1_reasoning_engine.py     # AI agent — LLM → JSON schema
├── phase2_storage_pipeline.py     # Hash + pin to IPFS
├── pipeline_orchestrator.py       # Phase 1→2→3 end-to-end runner
│
├── .env.example                   # Copy to .env and fill values
│
├── contracts/
│   ├── hardhat.config.ts
│   ├── contracts/
│   │   ├── TradeReasoningMarket.sol   # core contract (Phase 3)
│   │   └── MockERC20.sol              # testnet USDC
│   ├── scripts/
│   │   └── deploy.ts
│   └── test/
│       └── TradeReasoningMarket.test.ts
│
└── frontend/                      # Next.js App Router
    ├── wagmi.config.ts            # chain + connector config
    ├── app/
    │   ├── layout.tsx
    │   ├── providers.tsx          # Wagmi + React Query wrapper
    │   ├── page.tsx               # marketplace listing
    │   ├── globals.css
    │   └── trace/[hash]/
    │       └── page.tsx           # individual trace + wager/claim
    ├── components/
    │   └── WalletButton.tsx
    └── phase4_TraceMarketplace.tsx  # WagerForm component
```

---

## Quick Start

### 1. Environment

```bash
cp .env.example .env
# fill in ANTHROPIC_API_KEY, PINATA_JWT, ARC_RPC_URL, DEPLOYER_PRIVATE_KEY
```

### 2. Python backend

```bash
pip install anthropic pydantic requests python-dotenv web3

# Run Phase 1 only (mock LLM, no API key needed)
python phase1_reasoning_engine.py

# Run Phase 2 only (mock IPFS)
python phase2_storage_pipeline.py

# Run full pipeline (mock everything — zero external deps)
python pipeline_orchestrator.py

# Run full pipeline with live Anthropic API + Pinata
python pipeline_orchestrator.py --live-llm --pinata

# Broadcast to Arc testnet (requires DEPLOYER_PRIVATE_KEY + MARKET_CONTRACT)
python pipeline_orchestrator.py --live-llm --pinata --broadcast

# Continuous demo mode (new trace every 5 minutes)
python pipeline_orchestrator.py --continuous
```

### 3. Smart contracts

```bash
cd contracts
npm install

# Compile
npx hardhat compile

# Run tests
npx hardhat test

# Deploy to local hardhat node
npx hardhat node &
npx hardhat run scripts/deploy.ts --network hardhat

# Deploy to Arc testnet
npx hardhat run scripts/deploy.ts --network arc_testnet
```

After deployment, copy the addresses from `deployment.json` into `.env`.

### 4. Frontend

```bash
cd frontend
npm install

npm run dev     # http://localhost:3000
npm run build   # production build
```

---

## Smart Contract: Key Design Decisions

### Primary Key is a `bytes32` Hash
The SHA-256 of the canonical JSON is the on-chain primary key — not an auto-incrementing ID. This means:
- Anyone with the IPFS CID can independently re-derive the hash and verify it matches what's on-chain.
- No trust in any sequencer or indexer for content verification.

### Payout Formula
```
fee            = loserPool × 2%
distributable  = loserPool - fee
userPayout     = userStake + (userStake / totalWinnerPool) × distributable
```
If nobody is on the losing side, all stakes are returned in full (no fee on zero-loser markets).

### Oracle
For the hackathon, `resolveTrace()` is `onlyOwner`. In production, replace with:
- A Chainlink Functions callback that checks PnL against the on-chain trade record
- A multi-sig committee with a time-lock

---

## JSON Schema (Phase 1 Output)

```json
{
  "schema_version": "1.0.0",
  "trace_id": "<sha256 of signal>",
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

---

## Gas Estimates (Arc Testnet)

| Function          | Estimated Gas |
|-------------------|---------------|
| `registerTrace()` | ~85,000       |
| `placeWager()`    | ~75,000       |
| `resolveTrace()`  | ~35,000       |
| `claimWinnings()` | ~55,000       |

Arc fees are low, so even at 10 gwei this is fractions of a cent per call.

---

## Roadmap (Post-Hackathon)

- [ ] TheGraph subgraph to index `TraceRegistered` and `WagerPlaced` events
- [ ] Replace `onlyOwner` oracle with Chainlink Functions
- [ ] Irys (permanent Arweave storage) as fallback to IPFS
- [ ] Multi-asset portfolio traces (not just single-asset signals)
- [ ] Social layer: comment on a trace's reasoning steps
- [ ] Leaderboard: track which AI configurations produce the best traces over time


---

## Problem statement:
Trading-R1: Reasoning traces as the product (Wang et al., 2025, Tauric Research). Trading-R1 is a large-scale financial reasoning model whose value is the reasoning trace, not the trade. The full reasoning trace can be hashed and pinned (trace to IPFS/Irys, hash on Arc) without eroding PnL. That unlocks a new market type: bets on which reasoning patterns converge to profit, with TradingAgents v0.2.4's structured outputs (Trader / Research Manager / Portfolio Manager all emit JSON reasoning blocks) as the machine-readable substrate. More here: https://arxiv.org/abs/2509.11420


## its ai assisted

prompt:

---

### The Prompt for Claude

**Copy and paste everything below the line to Claude:**

---

**Role:** You are a Staff-Level Web3 Architect and AI Engineer.

**Objective:** I am building a project for the "Agora Agents Hackathon" (hosted by Canteen and Circle). I am implementing a concept based on the "Trading-R1" research paper. The core idea is that an AI agent's *reasoning trace* (its structured thought process regarding a financial trade) is the product itself, rather than the final trade execution.

We need to build a system where:

1. An AI agent generates a structured financial reasoning trace.
2. That trace is hashed and pinned to a decentralized storage network (e.g., IPFS/Irys).
3. The hash is recorded on Circle's Arc L1 blockchain.
4. Users can wager USDC on whether that specific reasoning trace will yield a profitable outcome.

**Tech Stack:**

* **AI/Backend Engine:** Python (or Rust for high-performance modules compiled to WebAssembly).
* **Storage:** IPFS / Irys (or similar decentralized storage).
* **Settlement Layer:** Solidity Smart Contracts deployed on the Arc testnet.
* **Frontend/UI:** Next.js (TypeScript/React).

**Task:** I need you to design the complete, step-by-step architecture and provide the foundational code for this system. Please break this down into the following four phases:

### Phase 1: The AI Reasoning Engine (Python)

Write a Python script that acts as the "Portfolio Manager".

* It should accept a mock market signal (e.g., price data, volatility metrics).
* It must use an LLM API (you can mock the API call or use standard OpenAI/Anthropic SDK syntax) to generate a response.
* **Critical:** The output *must* be forced into a strict, verifiable JSON schema that includes: `asset`, `regime`, `reasoning_trace` (the detailed logic), and `action` (e.g., Buy, Sell, Hold).

### Phase 2: The Immutable Storage Pipeline (Python/Node.js)

Provide the logic required to process the JSON output from Phase 1.

* Write a function to deterministically hash the JSON object (e.g., SHA-256).
* Provide a stub or example of how to upload that exact JSON payload to IPFS (using a common library or Pinata API) and return the CID (Content Identifier) and the Hash.

### Phase 3: The Settlement Layer (Solidity)

Write the core Solidity smart contract for the Arc Network.

* The contract needs a struct to represent a `ReasoningTrace` (storing the Hash, the creator, the timestamp, and the resolution status).
* It needs a function to `registerTrace(string memory _hash)`.
* It needs a function `placeWager(string memory _hash, bool _predictProfit)` that accepts USDC.
* It needs a mocked resolution function `resolveTrace(string memory _hash, bool _wasProfitable)` that distributes the pooled USDC to the winning wagers. (Assume the contract already holds USDC or handles the ERC20 transfer logic).

### Phase 4: The Marketplace UI (Next.js)

Provide the scaffolding for the Next.js frontend.

* Create a React component that fetches and displays a mock reasoning trace (reading the JSON).
* Include a basic UI for a user to connect their wallet (using standard web3 hooks like wagmi/viem) and a form to submit a "Bet on this Logic" transaction calling the smart contract from Phase 3.

**Constraints & Guidelines:**

* Keep the code modular and well-commented.
* Focus on the data pipeline (how the JSON moves from the LLM -> IPFS -> the Smart Contract).
* Ensure the Solidity contract is mindful of gas, even though Arc fees are low.
* Use standard, modern libraries for Next.js (Tailwind for styling is fine) and Python.

Please provide the architecture overview first, followed by the code blocks for each phase.

---
