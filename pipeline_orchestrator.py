"""
Trading-R1: Pipeline Orchestrator (OOP Refactor + Persistent Storage)
======================================================================
Modular class-based design. Four main classes:

    PipelineConfig      — all runtime settings in one place
    MarketDataFetcher   — live API data or randomised synthetic signals
    ReceiptStore        — persists receipts to disk (receipts/) + MongoDB
    TradingR1Pipeline   — chains Phase 1 → Phase 2 → Phase 3

Live data sources (all free, no API key required):
    CoinGecko public API  — price, volume, 24h change, 30d OHLC
    Binance Futures API   — perpetual funding rate
    Derived locally       — RSI(14), 30d annualised volatility, sentiment proxy

Storage:
    receipts/{trace_id[:12]}.json   — one file per trace, named by hash prefix
    MongoDB receipts collection      — upserted by trace_id (_id), ready for Next.js

Usage:
    python pipeline_orchestrator.py                        # dry run, random data
    python pipeline_orchestrator.py --live-data            # live CoinGecko prices
    python pipeline_orchestrator.py --asset ETH/USDC       # specific asset
    python pipeline_orchestrator.py --live-llm --pinata --broadcast --live-data
    python pipeline_orchestrator.py --continuous           # loop every 5 min
    python pipeline_orchestrator.py --continuous --live-data
"""

import json
import logging
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

try:
    from pymongo import MongoClient
    from pymongo.errors import PyMongoError

    _MONGO_AVAILABLE = True
except ImportError:
    _MONGO_AVAILABLE = False

sys.path.insert(0, str(Path(__file__).parent))
from phase1_reasoning_engine import MarketSignal, generate_reasoning_trace
from phase2_storage_pipeline import process_trace

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("trading-r1")

# ─── Types ────────────────────────────────────────────────────────────────────

StorageMode = Literal["pinata", "local", "mock"]

# ─── API endpoints ────────────────────────────────────────────────────────────

COINGECKO_BASE = "https://api.coingecko.com/api/v3"
BINANCE_FUTURES_BASE = "https://fapi.binance.com"

COINGECKO_IDS: dict[str, str] = {
    "BTC/USDC": "bitcoin",
    "ETH/USDC": "ethereum",
    "SOL/USDC": "solana",
    "ARB/USDC": "arbitrum",
}

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
    """
    Complete receipt linking every layer of the pipeline.

    Extra fields vs the original:
        status      — "open" on creation; frontend can update to "resolved"
        created_at  — Python datetime object (used as proper BSON date in Mongo)
    """

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

    # Deadlines (ISO UTC strings — easy to serialise everywhere)
    waging_deadline: str
    resolution_deadline: str
    registered_at_utc: str

    # Lifecycle — used by the Next.js frontend to filter cards
    status: str = "open"  # "open" | "resolved"


# ─── Receipt Store ────────────────────────────────────────────────────────────


class ReceiptStore:
    """
    Persists a PipelineReceipt to two destinations:

        1. receipts/{trace_id[:12]}.json   — local disk, one file per trace
        2. MongoDB receipts collection      — upserted by trace_id as _id

    Naming receipts by hash prefix (not a counter) means:
        - Re-running the same signal won't create duplicate files
        - You can look up a file with the same ID that's on-chain
        - Safe to run on multiple machines simultaneously

    MongoDB writes are best-effort: if the URI is not set or the write
    fails, a warning is logged but the pipeline does NOT crash.
    The trace is already on-chain and on disk — Mongo is a read cache.
    """

    COLLECTION = "receipts"

    def __init__(
        self,
        receipts_dir: str = "receipts",
        mongo_uri: Optional[str] = None,
        db_name: str = "trading_r1",
    ):
        self.receipts_dir = Path(receipts_dir)
        self.receipts_dir.mkdir(parents=True, exist_ok=True)

        self._mongo_client = None
        self._collection = None

        if mongo_uri and _MONGO_AVAILABLE:
            try:
                self._mongo_client = MongoClient(
                    mongo_uri, serverSelectionTimeoutMS=5_000
                )
                # Ping to validate connection before the first real write
                self._mongo_client.admin.command("ping")
                self._collection = self._mongo_client[db_name][self.COLLECTION]
                log.info(
                    "MongoDB connected  db=%s  collection=%s", db_name, self.COLLECTION
                )
            except Exception as exc:
                log.warning(
                    "MongoDB connection failed — disk-only mode. Reason: %s", exc
                )
                self._mongo_client = None
                self._collection = None
        elif mongo_uri and not _MONGO_AVAILABLE:
            log.warning(
                "MONGO_URI is set but pymongo is not installed. "
                "Run: pip install pymongo  — falling back to disk-only."
            )

    # ── Public ───────────────────────────────────────────────────────

    def persist(self, receipt: PipelineReceipt) -> Path:
        """
        Save receipt to disk and MongoDB (if available).
        Always returns the disk path so callers can log it.
        """
        disk_path = self._save_to_disk(receipt)
        self._save_to_mongo(receipt)  # soft failure — never raises
        return disk_path

    def close(self) -> None:
        """Close the MongoDB connection cleanly."""
        if self._mongo_client:
            self._mongo_client.close()

    # ── Private: disk ────────────────────────────────────────────────

    def _save_to_disk(self, receipt: PipelineReceipt) -> Path:
        """
        Write to receipts/{trace_id[:12]}.json.
        Uses the hash prefix so the filename is deterministic and collision-proof.
        """
        filename = f"{receipt.trace_id[:12]}.json"
        path = self.receipts_dir / filename

        with open(path, "w") as f:
            json.dump(asdict(receipt), f, indent=2)

        log.info("Receipt saved to disk  → %s", path)
        return path

    # ── Private: MongoDB ─────────────────────────────────────────────

    def _save_to_mongo(self, receipt: PipelineReceipt) -> None:
        """
        Upsert into MongoDB using trace_id as _id.
        Idempotent: running the same signal twice does not create duplicates.
        Never raises — failures are logged as warnings only.
        """
        if self._collection is None:
            return

        try:
            doc = self._to_mongo_doc(receipt)
            self._collection.replace_one(
                {"_id": doc["_id"]},
                doc,
                upsert=True,
            )
            log.info("Receipt upserted to MongoDB  _id=%s", doc["_id"][:12])
        except PyMongoError as exc:
            log.warning("MongoDB write failed (disk copy is safe). Reason: %s", exc)
        except Exception as exc:
            log.warning("Unexpected error during MongoDB write: %s", exc)

    @staticmethod
    def _to_mongo_doc(receipt: PipelineReceipt) -> dict:
        """
        Convert a PipelineReceipt to a MongoDB document.

        Key decisions:
            _id        → trace_id  (natural primary key, matches on-chain key)
            created_at → proper datetime object so Mongo sorts/indexes correctly
            status     → "open" by default; Next.js can $set to "resolved"
        """
        doc = asdict(receipt)

        # Use trace_id as the document _id (Mongo primary key)
        doc["_id"] = doc.pop("trace_id")

        # Store deadlines as real datetimes so Mongo TTL indexes work later
        doc["created_at"] = datetime.fromisoformat(receipt.registered_at_utc)
        doc["waging_deadline_dt"] = datetime.fromisoformat(receipt.waging_deadline)
        doc["resolution_deadline_dt"] = datetime.fromisoformat(
            receipt.resolution_deadline
        )

        return doc


# ─── Market Data Fetcher ──────────────────────────────────────────────────────


class MarketDataFetcher:
    """
    Provides MarketSignal objects two ways:

        fetch_live(asset)    — real data from CoinGecko + Binance (free APIs)
        fetch_random(asset)  — synthetic data with realistic value ranges

    Live data derivations:
        RSI(14)       — calculated from 30-day daily closes (CoinGecko OHLC)
        volatility    — annualised log-return std dev over 30 days
        funding_rate  — latest perpetual rate from Binance Futures
        sentiment     — proxy: normalised price momentum + RSI deviation
    """

    _PRICE_RANGES: dict[str, tuple[float, float]] = {
        "BTC/USDC": (20_000.0, 100_000.0),
        "ETH/USDC": (1_000.0, 6_000.0),
        "SOL/USDC": (10.0, 300.0),
        "ARB/USDC": (0.30, 3.0),
    }

    _VOLUME_RANGES: dict[str, tuple[float, float]] = {
        "BTC/USDC": (10e9, 60e9),
        "ETH/USDC": (5e9, 30e9),
        "SOL/USDC": (1e9, 10e9),
        "ARB/USDC": (100e6, 2e9),
    }

    _SCALAR_RANGES = {
        "price_change_24h_pct": (-8.0, 8.0),
        "volatility_30d": (0.30, 0.90),
        "rsi_14": (25.0, 75.0),
        "funding_rate": (-0.001, 0.001),
        "sentiment_score": (-0.8, 0.8),
    }

    # ── Public ───────────────────────────────────────────────────────

    def fetch_live(self, asset: str) -> MarketSignal:
        """Pull real market data for `asset` from free public APIs."""
        if asset not in COINGECKO_IDS:
            raise ValueError(f"Unsupported asset '{asset}'. Choose: {SUPPORTED_ASSETS}")

        cg_id = COINGECKO_IDS[asset]
        log.info("Fetching live data  asset=%s  coingecko_id=%s", asset, cg_id)

        spot = self._fetch_spot(cg_id)
        closes = self._fetch_ohlc_closes(cg_id, days=30)
        rsi_14 = self._rsi(closes, period=14)
        volatility = self._annualised_vol(closes)
        funding_rate = self._fetch_funding_rate(asset)
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
        """Generate a realistically bounded random MarketSignal."""
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
        url = f"{COINGECKO_BASE}/coins/{cg_id}/ohlc"
        params = {"vs_currency": "usd", "days": str(days)}
        resp = requests.get(url, params=params, timeout=10)
        resp.raise_for_status()
        return [row[4] for row in resp.json()]  # close price only

    def _fetch_funding_rate(self, asset: str) -> float:
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
            # Binance blocks some regions — fall back silently
            return round(random.uniform(-0.0003, 0.0003), 6)

    # ── Private: calculations ────────────────────────────────────────

    @staticmethod
    def _rsi(closes: list[float], period: int = 14) -> float:
        if len(closes) < period + 1:
            return 50.0
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
        Store    ReceiptStore.persist()      →  disk + MongoDB

    Typical usage:
        config   = PipelineConfig.for_dry_run()
        store    = ReceiptStore(mongo_uri=os.getenv("MONGO_URI"))
        pipeline = TradingR1Pipeline(config, store)

        receipt = pipeline.run_with_live_data("BTC/USDC")
        receipt = pipeline.run_with_random_data()
        pipeline.run_continuous(interval_seconds=300, use_live=True)
    """

    MARKET_ABI = _MARKET_ABI

    def __init__(self, config: PipelineConfig, store: Optional["ReceiptStore"] = None):
        self.config = config
        self.store = store
        self.fetcher = MarketDataFetcher()

    # ── Public entry points ──────────────────────────────────────────

    def run(self, signal: MarketSignal, data_source: str = "manual") -> PipelineReceipt:
        """Execute Phases 1 → 2 → 3 → Store for a given signal."""
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

        # Build receipt
        receipt = self._build_receipt(trace, storage, on_chain, now, data_source)
        self._print_receipt_summary(receipt)

        # Persist — disk always, MongoDB if configured
        if self.store:
            print("\n[Store] Persisting receipt…")
            disk_path = self.store.persist(receipt)
            print(f"        Disk  → {disk_path}")

        return receipt

    def run_with_live_data(self, asset: str) -> PipelineReceipt:
        signal = self.fetcher.fetch_live(asset)
        return self.run(signal, data_source="live")

    def run_with_random_data(self, asset: Optional[str] = None) -> PipelineReceipt:
        signal = self.fetcher.fetch_random(asset)
        return self.run(signal, data_source="random")

    def run_continuous(
        self,
        interval_seconds: int = 300,
        use_live: bool = False,
        asset: Optional[str] = None,
    ) -> None:
        """
        Loop forever — new trace on every interval.
        ReceiptStore handles all persistence; no manual file saving here.
        Continues even if an individual iteration fails.
        """
        mode_label = "live" if use_live else "random"
        log.info("Continuous mode  data=%s  interval=%ds", mode_label, interval_seconds)
        run_count = 0

        while True:
            run_count += 1
            chosen_asset = asset or random.choice(SUPPORTED_ASSETS)
            print(f"\n{'─' * 52}")
            print(
                f"  Run #{run_count:04d}  |  {chosen_asset}  |  "
                f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}"
            )
            print(f"{'─' * 52}")

            try:
                if use_live:
                    self.run_with_live_data(chosen_asset)
                else:
                    self.run_with_random_data(chosen_asset)
            except Exception as exc:
                log.error("Run #%04d failed: %s", run_count, exc)

            log.info("Sleeping %ds until next run…", interval_seconds)
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
        log.info("Tx broadcast: %s", tx_hash.hex())

        on_chain_receipt = w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if on_chain_receipt.status != 1:
            raise RuntimeError(f"Transaction reverted: {on_chain_receipt}")

        log.info("Confirmed in block %d", on_chain_receipt.blockNumber)
        return {"tx_hash": tx_hash.hex(), "block_number": on_chain_receipt.blockNumber}

    # ── Receipt builder ──────────────────────────────────────────────

    def _build_receipt(
        self, trace, storage, on_chain: dict, now: datetime, data_source: str
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
            status="open",
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
        print(f"  Status:       {receipt.status}")


# ─── CLI ──────────────────────────────────────────────────────────────────────


def _build_arg_parser():
    import argparse

    p = argparse.ArgumentParser(
        description="Trading-R1 pipeline orchestrator",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python pipeline_orchestrator.py                               # dry run, random data
  python pipeline_orchestrator.py --live-data                   # live market prices
  python pipeline_orchestrator.py --asset SOL/USDC              # specific asset
  python pipeline_orchestrator.py --asset ETH/USDC --live-data
  python pipeline_orchestrator.py --live-llm --pinata --broadcast --live-data
  python pipeline_orchestrator.py --continuous                  # loop, random data
  python pipeline_orchestrator.py --continuous --live-data      # loop, live data
        """,
    )
    p.add_argument("--asset", choices=SUPPORTED_ASSETS, default=None)
    p.add_argument(
        "--live-data", action="store_true", help="Fetch real prices from CoinGecko"
    )
    p.add_argument("--live-llm", action="store_true", help="Call real LLM API (Groq)")
    p.add_argument("--pinata", action="store_true", help="Pin to Pinata IPFS")
    p.add_argument("--broadcast", action="store_true", help="Send tx to Arc L1")
    p.add_argument("--continuous", action="store_true", help="Loop mode")
    p.add_argument(
        "--interval", type=int, default=300, help="Seconds between loops (default 300)"
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

    # ReceiptStore — wires up disk + Mongo from env vars automatically
    store = ReceiptStore(
        receipts_dir=os.getenv("RECEIPTS_DIR", "receipts"),
        mongo_uri=os.getenv("MONGO_URI"),  # None → disk-only, no crash
        db_name=os.getenv("MONGO_DB", "trading_r1"),
    )

    pipeline = TradingR1Pipeline(config, store)

    try:
        if args.continuous:
            pipeline.run_continuous(
                interval_seconds=args.interval,
                use_live=args.live_data,
                asset=args.asset,
            )
        elif args.live_data:
            asset = args.asset or random.choice(SUPPORTED_ASSETS)
            pipeline.run_with_live_data(asset)
        else:
            pipeline.run_with_random_data(args.asset)
    finally:
        store.close()


if __name__ == "__main__":
    main()
