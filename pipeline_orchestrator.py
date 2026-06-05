"""
Trading-R1: Pipeline Orchestrator (OOP Refactor)
=================================================
Modular class-based design. Three main classes:

    PipelineConfig      — all runtime settings in one place
    MarketDataFetcher   — live API data or randomised synthetic signals
    TradingR1Pipeline   — chains Phase 1 → Phase 2 → Phase 3

Live data sources (all free, no API key required):
    CoinGecko public API  — price, volume, 24h change, 30d OHLC
    Binance Futures API   — perpetual funding rate
    Derived locally       — RSI(14), 30d annualised volatility, sentiment proxy

Usage:
    python pipeline_orchestrator.py                        # dry run, random data
    python pipeline_orchestrator.py --live-data            # live CoinGecko prices
    python pipeline_orchestrator.py --asset ETH/USDC       # specific asset
    python pipeline_orchestrator.py --live-llm --pinata --broadcast
    python pipeline_orchestrator.py --continuous           # loop every 5 min
    python pipeline_orchestrator.py --continuous --live-data
"""

import json
import math
import os
import random
import statistics
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional

import requests
from dotenv import load_dotenv
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware

sys.path.insert(0, str(Path(__file__).parent))
from phase1_reasoning_engine import MarketSignal, generate_reasoning_trace
from phase2_storage_pipeline import process_trace

load_dotenv()

# ─── Types ────────────────────────────────────────────────────────────────────

StorageMode = Literal["pinata", "local", "mock"]

# ─── API endpoints ────────────────────────────────────────────────────────────

COINGECKO_BASE = "https://api.coingecko.com/api/v3"
BINANCE_FUTURES_BASE = "https://fapi.binance.com"

# Asset name → CoinGecko ID
COINGECKO_IDS: dict[str, str] = {
    "BTC/USDC": "bitcoin",
    "ETH/USDC": "ethereum",
    "SOL/USDC": "solana",
    "ARB/USDC": "arbitrum",
}

# Asset name → Binance perpetual futures symbol
BINANCE_SYMBOLS: dict[str, str] = {
    "BTC/USDC": "BTCUSDT",
    "ETH/USDC": "ETHUSDT",
    "SOL/USDC": "SOLUSDT",
    "ARB/USDC": "ARBUSDT",
}

SUPPORTED_ASSETS = list(COINGECKO_IDS.keys())

# ─── ABI ──────────────────────────────────────────────────────────────────────

_MARKET_ABI = [
    {
        "name": "registerTrace",
        "type": "function",
        "stateMutability": "nonpayable",
        "inputs": [
            {"name": "_hexHash", "type": "bytes32"},
            {"name": "_ipfsCid", "type": "string"},
            {"name": "_wagingWindow", "type": "uint256"},
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
                    {"name": "sha256Hash", "type": "bytes32"},
                    {"name": "ipfsCid", "type": "string"},
                    {"name": "creator", "type": "address"},
                    {"name": "registeredAt", "type": "uint256"},
                    {"name": "wagingDeadline", "type": "uint256"},
                    {"name": "resolutionDeadline", "type": "uint256"},
                    {"name": "resolved", "type": "bool"},
                    {"name": "wasProfitable", "type": "bool"},
                    {"name": "profitPool", "type": "uint256"},
                    {"name": "lossPool", "type": "uint256"},
                ],
            }
        ],
    },
]


# ─── Config ───────────────────────────────────────────────────────────────────


@dataclass
class PipelineConfig:
    """
    All runtime settings in one place. Reads from environment variables
    by default so nothing needs to be hardcoded.
    """

    # Phase 1
    use_mock_llm: bool = True

    # Phase 2
    storage_mode: StorageMode = "mock"

    # Phase 3
    dry_run: bool = True
    arc_rpc_url: str = field(
        default_factory=lambda: os.getenv("ARC_RPC_URL", "http://127.0.0.1:8545")
    )
    deployer_private_key: str = field(
        default_factory=lambda: os.getenv("DEPLOYER_PRIVATE_KEY", "")
    )
    market_contract_addr: str = field(
        default_factory=lambda: os.getenv("MARKET_CONTRACT", "")
    )

    # Timing
    waging_window_secs: int = 24 * 3_600  # 24 h
    resolution_window_secs: int = 7 * 24 * 3_600  # 7 days

    @classmethod
    def for_dry_run(cls) -> "PipelineConfig":
        """Full offline test — no API keys needed."""
        return cls(use_mock_llm=True, storage_mode="mock", dry_run=True)

    @classmethod
    def for_production(cls) -> "PipelineConfig":
        """Live LLM + Pinata IPFS + Arc broadcast."""
        return cls(use_mock_llm=False, storage_mode="pinata", dry_run=False)


# ─── Receipt ──────────────────────────────────────────────────────────────────


@dataclass
class PipelineReceipt:
    """Complete receipt linking every layer of the pipeline."""

    trace_id: str  # deterministic SHA-256 of the input signal
    asset: str
    action: str
    conviction: float
    data_source: str  # "live" | "random" | "manual"

    # Phase 2
    sha256_hex: str
    ipfs_cid: str
    ipfs_url: str

    # Phase 3
    tx_hash: str
    block_number: int
    contract_address: str

    # Deadlines
    waging_deadline: str  # ISO UTC
    resolution_deadline: str
    registered_at_utc: str

    def save(self, path: str) -> None:
        with open(path, "w") as f:
            json.dump(asdict(self), f, indent=2)
        print(f"Receipt saved → {path}")


# ─── Market Data Fetcher ──────────────────────────────────────────────────────


class MarketDataFetcher:
    """
    Provides MarketSignal objects two ways:

        fetch_live(asset)    — real data from CoinGecko + Binance (free APIs)
        fetch_random(asset)  — synthetic data with realistic value ranges

    Live data derivations:
        RSI(14)              — calculated from 30-day daily closes (CoinGecko OHLC)
        volatility_30d       — annualised log-return std dev over 30 days
        funding_rate         — latest perpetual rate from Binance Futures
        sentiment_score      — proxy: normalised price momentum + RSI deviation
    """

    # Realistic price ranges per asset (lo, hi) in USD
    _PRICE_RANGES: dict[str, tuple[float, float]] = {
        "BTC/USDC": (20_000.0, 100_000.0),
        "ETH/USDC": (1_000.0, 6_000.0),
        "SOL/USDC": (10.0, 300.0),
        "ARB/USDC": (0.30, 3.0),
    }

    # Realistic 24h volume ranges per asset
    _VOLUME_RANGES: dict[str, tuple[float, float]] = {
        "BTC/USDC": (10e9, 60e9),
        "ETH/USDC": (5e9, 30e9),
        "SOL/USDC": (1e9, 10e9),
        "ARB/USDC": (100e6, 2e9),
    }

    # Generic scalar ranges shared across assets
    _SCALAR_RANGES = {
        "price_change_24h_pct": (-8.0, 8.0),
        "volatility_30d": (0.30, 0.90),
        "rsi_14": (25.0, 75.0),
        "funding_rate": (-0.001, 0.001),
        "sentiment_score": (-0.8, 0.8),
    }

    # ── Public interface ─────────────────────────────────────────────

    def fetch_live(self, asset: str) -> MarketSignal:
        """
        Pull real market data for `asset` from free public APIs.
        Falls back gracefully on individual field failures (e.g. rate limit).
        """
        if asset not in COINGECKO_IDS:
            raise ValueError(
                f"Unsupported asset '{asset}'. Choose from: {SUPPORTED_ASSETS}"
            )

        cg_id = COINGECKO_IDS[asset]
        print(f"   Fetching live data for {asset} (CoinGecko id={cg_id})…")

        # --- Spot price, 24 h change, volume ---
        spot = self._fetch_spot(cg_id)

        # --- 30-day OHLC closes for RSI + volatility ---
        closes = self._fetch_ohlc_closes(cg_id, days=30)

        rsi_14 = self._rsi(closes, period=14)
        volatility = self._annualised_vol(closes)

        # --- Perpetual funding rate ---
        funding_rate = self._fetch_funding_rate(asset)

        # --- Derived sentiment proxy ---
        sentiment = self._sentiment_proxy(spot["price_change_24h_pct"], rsi_14)

        return MarketSignal(
            asset=asset,
            price_usd=spot["price_usd"],
            price_change_24h_pct=spot["price_change_24h_pct"],
            volume_24h_usd=spot["volume_24h_usd"],
            volatility_30d=volatility,
            rsi_14=rsi_14,
            funding_rate=funding_rate,
            sentiment_score=sentiment,
        )

    def fetch_random(self, asset: Optional[str] = None) -> MarketSignal:
        """
        Generate a randomised but realistically bounded MarketSignal.
        If `asset` is None, a random supported asset is chosen.
        """
        asset = asset or random.choice(SUPPORTED_ASSETS)
        r = self._SCALAR_RANGES

        return MarketSignal(
            asset=asset,
            price_usd=self._rnd(*self._PRICE_RANGES.get(asset, (100.0, 10_000.0))),
            price_change_24h_pct=self._rnd(*r["price_change_24h_pct"]),
            volume_24h_usd=self._rnd(*self._VOLUME_RANGES.get(asset, (1e9, 10e9))),
            volatility_30d=self._rnd(*r["volatility_30d"]),
            rsi_14=self._rnd(*r["rsi_14"]),
            funding_rate=self._rnd(*r["funding_rate"]),
            sentiment_score=self._rnd(*r["sentiment_score"]),
        )

    # ── Private: API calls ───────────────────────────────────────────

    def _fetch_spot(self, cg_id: str) -> dict:
        """Returns price_usd, price_change_24h_pct, volume_24h_usd."""
        url = f"{COINGECKO_BASE}/coins/markets"
        params = {
            "vs_currency": "usd",
            "ids": cg_id,
            "price_change_percentage": "24h",
        }
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()[0]
        return {
            "price_usd": data["current_price"],
            "price_change_24h_pct": data.get("price_change_percentage_24h") or 0.0,
            "volume_24h_usd": data.get("total_volume") or 0.0,
        }

    def _fetch_ohlc_closes(self, cg_id: str, days: int = 30) -> list[float]:
        """
        Returns a list of daily close prices from CoinGecko OHLC.
        Each row is [timestamp, open, high, low, close].
        """
        url = f"{COINGECKO_BASE}/coins/{cg_id}/ohlc"
        params = {"vs_currency": "usd", "days": str(days)}
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        rows = resp.json()  # [[ts, o, h, l, c], ...]
        return [row[4] for row in rows]  # close prices only

    def _fetch_funding_rate(self, asset: str) -> float:
        """Latest perpetual funding rate from Binance Futures (public endpoint)."""
        symbol = BINANCE_SYMBOLS.get(asset)
        if not symbol:
            return 0.0
        try:
            url = f"{BINANCE_FUTURES_BASE}/fapi/v1/fundingRate"
            resp = requests.get(url, params={"symbol": symbol, "limit": 1}, timeout=5)
            resp.raise_for_status()
            rows = resp.json()
            return float(rows[0]["fundingRate"]) if rows else 0.0
        except Exception:
            # Binance may block certain regions; fall back to a small random value
            return round(random.uniform(-0.0003, 0.0003), 6)

    # ── Private: Calculations ────────────────────────────────────────

    @staticmethod
    def _rsi(closes: list[float], period: int = 14) -> float:
        """Wilder RSI from a sequence of closing prices."""
        if len(closes) < period + 1:
            return 50.0  # neutral fallback on insufficient history
        deltas = [closes[i + 1] - closes[i] for i in range(len(closes) - 1)]
        gains = [max(d, 0.0) for d in deltas]
        losses = [abs(min(d, 0.0)) for d in deltas]
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return round(100.0 - (100.0 / (1.0 + rs)), 2)

    @staticmethod
    def _annualised_vol(closes: list[float]) -> float:
        """30-day log-return standard deviation, annualised (×√365)."""
        if len(closes) < 2:
            return 0.50
        log_returns = [
            math.log(closes[i + 1] / closes[i])
            for i in range(len(closes) - 1)
            if closes[i] > 0 and closes[i + 1] > 0
        ]
        if len(log_returns) < 2:
            return 0.50
        return round(statistics.stdev(log_returns) * math.sqrt(365), 4)

    @staticmethod
    def _sentiment_proxy(price_change_pct: float, rsi: float) -> float:
        """
        Naive sentiment estimate in [-1, +1]:
            momentum   = price_change clamped to ±10 %, scaled to ±0.5
            rsi_signal = RSI deviation from 50, scaled to ±0.5
        """
        momentum = max(-0.5, min(0.5, price_change_pct / 10.0 * 0.5))
        rsi_signal = max(-0.5, min(0.5, (rsi - 50.0) / 50.0 * 0.5))
        return round(momentum + rsi_signal, 4)

    @staticmethod
    def _rnd(lo: float, hi: float) -> float:
        return random.uniform(lo, hi)


# ─── Pipeline ─────────────────────────────────────────────────────────────────


class TradingR1Pipeline:
    """
    Orchestrates the full Trading-R1 pipeline:

        Phase 1  generate_reasoning_trace()  →  ReasoningTrace JSON
        Phase 2  process_trace()             →  StorageReceipt (SHA-256 + CID)
        Phase 3  _register_on_chain()        →  Arc L1 tx hash

    Typical usage:
        config   = PipelineConfig.for_dry_run()
        pipeline = TradingR1Pipeline(config)

        # one-shot with live data
        receipt = pipeline.run_with_live_data("BTC/USDC")

        # one-shot with random data
        receipt = pipeline.run_with_random_data()

        # loop
        pipeline.run_continuous(interval_seconds=300, use_live=True)
    """

    MARKET_ABI = _MARKET_ABI

    def __init__(self, config: PipelineConfig):
        self.config = config
        self.fetcher = MarketDataFetcher()

    # ── Public entry points ──────────────────────────────────────────

    def run(self, signal: MarketSignal, data_source: str = "manual") -> PipelineReceipt:
        """Execute Phases 1 → 2 → 3 for an already-constructed signal."""
        now = datetime.now(timezone.utc)
        cfg = self.config

        self._print_banner(now)
        self._print_signal(signal, data_source)

        # Phase 1 — AI reasoning
        print("\n[Phase 1] Generating reasoning trace…")
        trace, trace_json = generate_reasoning_trace(signal, use_mock=cfg.use_mock_llm)
        self._print_trace_summary(trace)

        # Phase 2 — hashing + IPFS
        print(f"\n[Phase 2] Hashing and pinning (mode={cfg.storage_mode})…")
        storage = process_trace(trace_json, mode=cfg.storage_mode)

        # Phase 3 — on-chain registration
        print(f"\n[Phase 3] Registering on Arc L1 (dry_run={cfg.dry_run})…")
        on_chain = self._register_on_chain(storage.sha256_hex, storage.ipfs_cid)

        receipt = self._build_receipt(trace, storage, on_chain, now, data_source)
        self._print_receipt_summary(receipt)
        return receipt

    def run_with_live_data(self, asset: str) -> PipelineReceipt:
        """Fetch live market data then run the full pipeline."""
        signal = self.fetcher.fetch_live(asset)
        return self.run(signal, data_source="live")

    def run_with_random_data(self, asset: Optional[str] = None) -> PipelineReceipt:
        """Generate a random signal then run the full pipeline."""
        signal = self.fetcher.fetch_random(asset)
        return self.run(signal, data_source="random")

    def run_continuous(
        self,
        interval_seconds: int = 300,
        use_live: bool = False,
        asset: Optional[str] = None,
    ) -> None:
        """
        Loop forever, cycling through assets, saving one receipt per run.
        Continues even if an individual iteration fails.

        Args:
            interval_seconds: Sleep between iterations (default 5 min).
            use_live:         True = live CoinGecko data; False = random.
            asset:            Pin to a specific asset; None = rotate randomly.
        """
        mode_label = "live" if use_live else "random"
        print(f"Continuous mode | data={mode_label} | interval={interval_seconds}s")
        run_count = 0

        while True:
            run_count += 1
            chosen_asset = asset or random.choice(SUPPORTED_ASSETS)
            print(f"\n{'─' * 50}")
            print(
                f"Run #{run_count:04d} | {chosen_asset} | {datetime.now(timezone.utc).isoformat()}"
            )
            print(f"{'─' * 50}")

            try:
                if use_live:
                    receipt = self.run_with_live_data(chosen_asset)
                else:
                    receipt = self.run_with_random_data(chosen_asset)

                out_path = f"pipeline_receipt_{run_count:04d}.json"
                receipt.save(out_path)

            except Exception as exc:
                print(f"[ERROR] Run #{run_count} failed: {exc}")

            print(f"Sleeping {interval_seconds}s…")
            time.sleep(interval_seconds)

    # ── Phase 3: on-chain registration ──────────────────────────────

    def _register_on_chain(self, sha256_hex: str, ipfs_cid: str) -> dict:
        cfg = self.config

        if not cfg.deployer_private_key:
            raise EnvironmentError("DEPLOYER_PRIVATE_KEY not set in .env")
        if not cfg.market_contract_addr:
            raise EnvironmentError("MARKET_CONTRACT not set in .env")

        w3 = Web3(Web3.HTTPProvider(cfg.arc_rpc_url))
        w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

        if not w3.is_connected():
            raise ConnectionError(f"Cannot connect to Arc RPC at {cfg.arc_rpc_url}")

        account = w3.eth.account.from_key(cfg.deployer_private_key)
        contract = w3.eth.contract(
            address=Web3.to_checksum_address(cfg.market_contract_addr),
            abi=self.MARKET_ABI,
        )
        hash_bytes32 = bytes.fromhex(sha256_hex)

        if cfg.dry_run:
            data = contract.encode_abi(
                "registerTrace",
                args=[
                    hash_bytes32,
                    ipfs_cid,
                    cfg.waging_window_secs,
                    cfg.resolution_window_secs,
                ],
            )
            print(f"[DRY RUN] Encoded calldata: {data[:66]}…")
            return {"tx_hash": "0x" + "00" * 32, "block_number": 0}

        # Build → sign → send
        nonce = w3.eth.get_transaction_count(account.address)
        tx = contract.functions.registerTrace(
            hash_bytes32,
            ipfs_cid,
            cfg.waging_window_secs,
            cfg.resolution_window_secs,
        ).build_transaction(
            {
                "from": account.address,
                "nonce": nonce,
                "gasPrice": w3.eth.gas_price,
                "gas": 300_000,
            }
        )
        signed = account.sign_transaction(tx)
        tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
        print(f"Tx broadcast: {tx_hash.hex()}")

        on_chain_receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if on_chain_receipt.status != 1:
            raise RuntimeError(f"Transaction reverted: {on_chain_receipt}")

        print(f"Confirmed in block {on_chain_receipt.blockNumber}")
        return {
            "tx_hash": tx_hash.hex(),
            "block_number": on_chain_receipt.blockNumber,
        }

    # ── Receipt builder ──────────────────────────────────────────────

    def _build_receipt(
        self, trace, storage, on_chain, now: datetime, data_source: str
    ) -> PipelineReceipt:
        cfg = self.config
        t = time.time()
        return PipelineReceipt(
            trace_id=trace.trace_id,
            asset=trace.asset,
            action=trace.action,
            conviction=trace.conviction,
            data_source=data_source,
            sha256_hex=storage.sha256_hex,
            ipfs_cid=storage.ipfs_cid,
            ipfs_url=storage.ipfs_url,
            tx_hash=on_chain["tx_hash"],
            block_number=on_chain["block_number"],
            contract_address=cfg.market_contract_addr,
            waging_deadline=datetime.fromtimestamp(
                t + cfg.waging_window_secs, tz=timezone.utc
            ).isoformat(),
            resolution_deadline=datetime.fromtimestamp(
                t + cfg.waging_window_secs + cfg.resolution_window_secs, tz=timezone.utc
            ).isoformat(),
            registered_at_utc=now.isoformat(),
        )

    # ── Print helpers ────────────────────────────────────────────────

    @staticmethod
    def _print_banner(now: datetime) -> None:
        print("\n" + "=" * 60)
        print("  Trading-R1 Pipeline")
        print(f"  {now.isoformat()}")
        print("=" * 60)

    @staticmethod
    def _print_signal(signal: MarketSignal, source: str) -> None:
        print(f"\n  Signal ({source}):")
        print(f"    Asset:       {signal.asset}")
        print(f"    Price:       ${signal.price_usd:,.2f}")
        print(f"    24h Change:  {signal.price_change_24h_pct:+.2f}%")
        print(f"    Volume:      ${signal.volume_24h_usd:,.0f}")
        print(f"    Volatility:  {signal.volatility_30d:.1%}")
        print(f"    RSI(14):     {signal.rsi_14:.1f}")
        print(f"    Funding:     {signal.funding_rate:.4f}")
        print(f"    Sentiment:   {signal.sentiment_score:+.2f}")

    @staticmethod
    def _print_trace_summary(trace) -> None:
        print(f"   Asset:      {trace.asset}")
        print(f"   Action:     {trace.action}")
        print(f"   Regime:     {trace.regime}")
        print(f"   Conviction: {trace.conviction:.0%}")
        print(f"   Trace ID:   {trace.trace_id[:20]}…")

    @staticmethod
    def _print_receipt_summary(receipt: PipelineReceipt) -> None:
        print("\n" + "=" * 60)
        print("  Pipeline Complete!")
        print("=" * 60)
        print(f"  Data Source:  {receipt.data_source}")
        print(f"  Asset:        {receipt.asset}  →  {receipt.action}")
        print(f"  Conviction:   {receipt.conviction:.0%}")
        print(f"  Trace ID:     {receipt.trace_id[:20]}…")
        print(f"  SHA-256:      {receipt.sha256_hex[:20]}…")
        print(f"  IPFS CID:     {receipt.ipfs_cid}")
        print(f"  Tx Hash:      {receipt.tx_hash[:20]}…")
        print(f"  Block:        {receipt.block_number}")
        print(f"  Wager until:  {receipt.waging_deadline}")


# ─── CLI ──────────────────────────────────────────────────────────────────────


def _build_arg_parser():
    import argparse

    p = argparse.ArgumentParser(
        description="Trading-R1 pipeline orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python pipeline_orchestrator.py                          # dry run, random data
  python pipeline_orchestrator.py --live-data              # live market prices
  python pipeline_orchestrator.py --asset SOL/USDC         # specific asset (random data)
  python pipeline_orchestrator.py --asset ETH/USDC --live-data
  python pipeline_orchestrator.py --live-llm --pinata --broadcast
  python pipeline_orchestrator.py --continuous             # loop, random data
  python pipeline_orchestrator.py --continuous --live-data # loop, live data
        """,
    )
    p.add_argument(
        "--asset",
        choices=SUPPORTED_ASSETS,
        default=None,
        help="Asset to analyse (default: random each run)",
    )
    p.add_argument(
        "--live-data",
        action="store_true",
        help="Fetch real prices from CoinGecko instead of generating random data",
    )
    p.add_argument("--live-llm", action="store_true", help="Call real LLM API (Groq)")
    p.add_argument("--pinata", action="store_true", help="Pin to Pinata IPFS")
    p.add_argument("--broadcast", action="store_true", help="Send tx to Arc L1")
    p.add_argument(
        "--continuous",
        action="store_true",
        help="Loop mode — new trace every --interval seconds",
    )
    p.add_argument(
        "--interval",
        type=int,
        default=300,
        help="Seconds between runs in continuous mode (default: 300)",
    )
    return p


def main() -> None:
    parser = _build_arg_parser()
    args = parser.parse_args()

    config = PipelineConfig(
        use_mock_llm=not args.live_llm,
        storage_mode="pinata" if args.pinata else "mock",
        dry_run=not args.broadcast,
    )

    pipeline = TradingR1Pipeline(config)

    if args.continuous:
        pipeline.run_continuous(
            interval_seconds=args.interval,
            use_live=args.live_data,
            asset=args.asset,
        )
    elif args.live_data:
        asset = args.asset or random.choice(SUPPORTED_ASSETS)
        receipt = pipeline.run_with_live_data(asset)
        receipt.save("pipeline_receipt.json")
    else:
        receipt = pipeline.run_with_random_data(args.asset)
        receipt.save("pipeline_receipt.json")


if __name__ == "__main__":
    main()
