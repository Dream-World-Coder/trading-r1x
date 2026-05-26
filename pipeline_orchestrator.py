"""
Trading-R1: End-to-End Pipeline Orchestrator
=============================================
Chains Phase 1 → Phase 2 → Phase 3 in a single script.

  MarketSignal
      │
      ▼
  [Phase 1] generate_reasoning_trace()   → ReasoningTrace JSON
      │
      ▼
  [Phase 2] process_trace()              → StorageReceipt (SHA-256 + CID)
      │
      ▼
  [Phase 3] register_trace_on_chain()    → tx_hash (Arc L1)
      │
      ▼
  pipeline_receipt.json                  ← link everything for the frontend

Install deps:
    pip install web3 python-dotenv pydantic anthropic requests

Environment variables (in .env):
    ANTHROPIC_API_KEY=sk-ant-...
    PINATA_JWT=eyJ...
    ARC_RPC_URL=https://rpc.arc-testnet.example.com
    DEPLOYER_PRIVATE_KEY=0x...
    MARKET_CONTRACT=0x...        # from deployment.json
"""

import json
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

# Import Phase 1 and Phase 2 modules
sys.path.insert(0, str(Path(__file__).parent))
from phase1_reasoning_engine import MarketSignal, generate_reasoning_trace
from phase2_storage_pipeline import process_trace

load_dotenv()

# ─── Configuration ────────────────────────────────────────────────────────────

ARC_RPC_URL = os.getenv("ARC_RPC_URL", "http://127.0.0.1:8545")
DEPLOYER_PRIVATE_KEY = os.getenv("DEPLOYER_PRIVATE_KEY", "")
MARKET_CONTRACT_ADDR = os.getenv("MARKET_CONTRACT", "")

# Waging window: 24h for wagers to come in, 7 days to resolve
WAGING_WINDOW_SECS = 24 * 3_600
RESOLUTION_WINDOW_SECS = 7 * 24 * 3_600

# ─── Minimal ABI for registerTrace ────────────────────────────────────────────

MARKET_ABI = [
    {
        "name": "registerTrace",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "_hexHash",          "type": "bytes32"},
            {"name": "_ipfsCid",          "type": "string"},
            {"name": "_wagingWindow",     "type": "uint256"},
            {"name": "_resolutionWindow", "type": "uint256"},
        ],
        "outputs": [],
    },
    {
        "name": "getTrace",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"name": "_hash", "type": "bytes32"}],
        "outputs": [
            {
                "type": "tuple",
                "components": [
                    {"name": "sha256Hash",         "type": "bytes32"},
                    {"name": "ipfsCid",            "type": "string"},
                    {"name": "creator",            "type": "address"},
                    {"name": "registeredAt",       "type": "uint256"},
                    {"name": "wagingDeadline",     "type": "uint256"},
                    {"name": "resolutionDeadline", "type": "uint256"},
                    {"name": "resolved",           "type": "bool"},
                    {"name": "wasProfitable",      "type": "bool"},
                    {"name": "profitPool",         "type": "uint256"},
                    {"name": "lossPool",           "type": "uint256"},
                ],
            }
        ],
    },
]


# ─── Data ─────────────────────────────────────────────────────────────────────

@dataclass
class PipelineReceipt:
    """Complete receipt linking every layer of the pipeline."""
    trace_id:           str    # deterministic from Phase 1
    asset:              str
    action:             str
    conviction:         float
    sha256_hex:         str    # from Phase 2
    ipfs_cid:           str    # from Phase 2
    ipfs_url:           str    # from Phase 2
    tx_hash:            str    # Phase 3 — Arc L1 transaction
    block_number:       int    # Arc L1 block
    contract_address:   str
    waging_deadline:    str    # ISO UTC
    resolution_deadline: str   # ISO UTC
    registered_at_utc:  str


# ─── Phase 3: On-chain registration ────────────────────────────────────────────

def register_trace_on_chain(
    sha256_hex: str,
    ipfs_cid:   str,
    dry_run:    bool = False,
) -> dict:
    """
    Sends a registerTrace() transaction to the Arc smart contract.

    Args:
        sha256_hex:  64-char hex string (no 0x prefix) from Phase 2.
        ipfs_cid:    IPFS content identifier.
        dry_run:     If True, encode the tx but don't broadcast (for testing).

    Returns:
        dict with tx_hash and block_number.
    """
    if not DEPLOYER_PRIVATE_KEY:
        raise EnvironmentError("Set DEPLOYER_PRIVATE_KEY in .env")
    if not MARKET_CONTRACT_ADDR:
        raise EnvironmentError("Set MARKET_CONTRACT in .env")

    # Connect to Arc RPC
    w3 = Web3(Web3.HTTPProvider(ARC_RPC_URL))
    w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)  # for PoA chains

    if not w3.is_connected():
        raise ConnectionError(f"Cannot connect to Arc RPC at {ARC_RPC_URL}")

    account = w3.eth.account.from_key(DEPLOYER_PRIVATE_KEY)
    contract = w3.eth.contract(
        address=Web3.to_checksum_address(MARKET_CONTRACT_ADDR),
        abi=MARKET_ABI,
    )

    # Convert hex string to bytes32
    hash_bytes32 = bytes.fromhex(sha256_hex)

    if dry_run:
        # Just encode — no broadcast
        data = contract.encode_abi(
            "registerTrace",
            args=[hash_bytes32, ipfs_cid, WAGING_WINDOW_SECS, RESOLUTION_WINDOW_SECS],
        )
        print(f"[DRY RUN] Encoded calldata: {data[:66]}…")
        return {
            "tx_hash": "0x" + "00" * 32,  # mock
            "block_number": 0,
        }

    # Build transaction
    nonce = w3.eth.get_transaction_count(account.address)
    gas_price = w3.eth.gas_price

    tx = contract.functions.registerTrace(
        hash_bytes32,
        ipfs_cid,
        WAGING_WINDOW_SECS,
        RESOLUTION_WINDOW_SECS,
    ).build_transaction({
        "from":     account.address,
        "nonce":    nonce,
        "gasPrice": gas_price,
        "gas":      300_000,   # safe upper bound; refunded if unused
    })

    # Sign and send
    signed = account.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    print(f"Tx broadcast: {tx_hash.hex()}")

    # Wait for confirmation
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    if receipt.status != 1:
        raise RuntimeError(f"Transaction reverted. Receipt: {receipt}")

    print(f"Confirmed in block {receipt.blockNumber}")
    return {
        "tx_hash":      tx_hash.hex(),
        "block_number": receipt.blockNumber,
    }


# ─── Full Pipeline ────────────────────────────────────────────────────────────

def run_pipeline(
    signal:       MarketSignal,
    use_mock_llm: bool = True,
    storage_mode: str  = "mock",   # "pinata" | "local" | "mock"
    dry_run:      bool = True,
) -> PipelineReceipt:
    """
    Execute the full Trading-R1 pipeline:
      Phase 1 → Phase 2 → Phase 3

    Args:
        signal:        Market signal to reason about.
        use_mock_llm:  True = no API call; False = real Anthropic API.
        storage_mode:  "pinata" | "local" | "mock"
        dry_run:       True = Phase 3 encodes but does not broadcast.
    """
    now = datetime.now(timezone.utc)

    print("=" * 60)
    print("  Trading-R1 Pipeline")
    print(f"  {now.isoformat()}")
    print("=" * 60)

    # ── Phase 1 ───────────────────────────────────────────────────────
    print("\n[Phase 1] Generating reasoning trace…")
    trace, trace_json = generate_reasoning_trace(signal, use_mock=use_mock_llm)
    print(f"   Asset:    {trace.asset}")
    print(f"   Action:   {trace.action}")
    print(f"   Regime:   {trace.regime}")
    print(f"   Conviction: {trace.conviction:.0%}")
    print(f"   Trace ID: {trace.trace_id[:20]}…")

    # ── Phase 2 ───────────────────────────────────────────────────────
    print(f"\n[Phase 2] Hashing and pinning to IPFS (mode={storage_mode})…")
    storage = process_trace(trace_json, mode=storage_mode)

    # ── Phase 3 ───────────────────────────────────────────────────────
    print(f"\n[Phase 3] Registering on Arc L1 (dry_run={dry_run})…")
    on_chain = register_trace_on_chain(
        sha256_hex=storage.sha256_hex,
        ipfs_cid=storage.ipfs_cid,
        dry_run=dry_run,
    )

    # ── Receipt ───────────────────────────────────────────────────────
    waging_deadline = datetime.fromtimestamp(
        time.time() + WAGING_WINDOW_SECS, tz=timezone.utc
    ).isoformat()
    resolution_deadline = datetime.fromtimestamp(
        time.time() + WAGING_WINDOW_SECS + RESOLUTION_WINDOW_SECS, tz=timezone.utc
    ).isoformat()

    receipt = PipelineReceipt(
        trace_id=trace.trace_id,
        asset=trace.asset,
        action=trace.action,
        conviction=trace.conviction,
        sha256_hex=storage.sha256_hex,
        ipfs_cid=storage.ipfs_cid,
        ipfs_url=storage.ipfs_url,
        tx_hash=on_chain["tx_hash"],
        block_number=on_chain["block_number"],
        contract_address=MARKET_CONTRACT_ADDR,
        waging_deadline=waging_deadline,
        resolution_deadline=resolution_deadline,
        registered_at_utc=now.isoformat(),
    )

    print("\n" + "=" * 60)
    print("  Pipeline Complete!")
    print("=" * 60)
    print(f"  Trace ID:     {receipt.trace_id[:20]}…")
    print(f"  SHA-256:      {receipt.sha256_hex[:20]}…")
    print(f"  IPFS CID:     {receipt.ipfs_cid}")
    print(f"  Tx Hash:      {receipt.tx_hash[:20]}…")
    print(f"  Block:        {receipt.block_number}")
    print(f"  Wager until:  {receipt.waging_deadline}")

    return receipt


# ─── Continuous Mode (cron / scheduler) ───────────────────────────────────────

def run_continuous(interval_seconds: int = 3_600):
    """
    Runs the pipeline on a fixed interval — useful for a live demo.
    Each iteration fetches a fresh mock signal and publishes a new trace.
    """
    import random

    print(f"Continuous mode: generating a trace every {interval_seconds}s")
    run_count = 0

    while True:
        run_count += 1
        print(f"\n──── Run #{run_count} ────")

        signal = MarketSignal(
            asset=random.choice(["BTC/USDC", "ETH/USDC", "SOL/USDC", "ARB/USDC"]),
            price_usd=random.uniform(1_000, 70_000),
            price_change_24h_pct=random.uniform(-8, 8),
            volume_24h_usd=random.uniform(5e9, 50e9),
            volatility_30d=random.uniform(0.3, 0.9),
            rsi_14=random.uniform(25, 75),
            funding_rate=random.uniform(-0.001, 0.001),
            sentiment_score=random.uniform(-0.8, 0.8),
        )

        try:
            receipt = run_pipeline(
                signal,
                use_mock_llm=True,
                storage_mode="mock",
                dry_run=True,
            )
            # Save each receipt
            out = f"pipeline_receipt_{run_count:04d}.json"
            with open(out, "w") as f:
                json.dump(receipt.__dict__, f, indent=2)
            print(f"Saved {out}")
        except Exception as exc:
            print(f"Pipeline error (run #{run_count}): {exc}")

        time.sleep(interval_seconds)


# ─── CLI ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Trading-R1 pipeline orchestrator")
    parser.add_argument("--live-llm",   action="store_true", help="Use real Anthropic API")
    parser.add_argument("--pinata",     action="store_true", help="Pin to Pinata IPFS")
    parser.add_argument("--broadcast",  action="store_true", help="Actually send the tx to Arc")
    parser.add_argument("--continuous", action="store_true", help="Loop mode (for demos)")
    args = parser.parse_args()

    if args.continuous:
        run_continuous(interval_seconds=300)  # every 5 min for demo
    else:
        sample_signal = MarketSignal(
            asset="BTC/USDC",
            price_usd=63_420.50,
            price_change_24h_pct=-3.21,
            volume_24h_usd=28_400_000_000,
            volatility_30d=0.62,
            rsi_14=38.5,
            funding_rate=-0.0002,
            sentiment_score=-0.35,
        )

        receipt = run_pipeline(
            signal=sample_signal,
            use_mock_llm=not args.live_llm,
            storage_mode="pinata" if args.pinata else "mock",
            dry_run=not args.broadcast,
        )

        out_path = "pipeline_receipt.json"
        with open(out_path, "w") as f:
            json.dump(receipt.__dict__, f, indent=2)
        print(f"\n💾 Full receipt saved to {out_path}")
