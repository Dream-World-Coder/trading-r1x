from datetime import datetime, timezone

from pydantic import BaseModel, Field


class MarketSignal(BaseModel):
    """Input signal fed to the reasoning engine."""

    asset: str  # e.g. "BTC/USDC"
    price_usd: float
    price_change_24h_pct: float  # e.g. -3.2 means -3.2%
    volume_24h_usd: float
    volatility_30d: float  # annualised vol e.g. 0.65 = 65%
    rsi_14: float  # 0-100
    funding_rate: float  # perp funding, e.g. 0.0001
    sentiment_score: float  # -1.0 (bearish) to +1.0 (bullish)
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
