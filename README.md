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
