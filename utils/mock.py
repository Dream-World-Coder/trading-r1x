import json
from datetime import datetime, timezone


def call_llm_mock(system: str, user: str) -> str:
    """
    Deterministic mock — use this for offline testing / CI.
    Returns a valid ReasoningTrace JSON with no API call.
    """
    mock_response = {
        "schema_version": "1.0.0",
        "trace_id": "INJECTED_BY_ENGINE",  # overwritten below
        "asset": "BTC/USDC",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "regime": "HIGH_VOL_UNCERTAIN",
        "reasoning_trace": [
            {
                "step": 1,
                "thought": "RSI at 38.5 is approaching oversold territory but has not confirmed a reversal. "
                "This suggests selling pressure remains elevated without capitulation.",
                "evidence": "RSI(14) = 38.5; historically BTC bounces occur sub-30",
            },
            {
                "step": 2,
                "thought": "The negative funding rate of -0.0002 indicates short-side dominance in perpetuals. "
                "Sustained negative funding often precedes squeeze events, but timing is uncertain.",
                "evidence": "Funding rate = -0.0002 (negative = shorts pay longs)",
            },
            {
                "step": 3,
                "thought": "Sentiment at -0.35 is moderately bearish. Combined with a 30d vol of 62%, "
                "the risk-reward for a directional bet is unfavourable. A HOLD preserves optionality.",
                "evidence": "Sentiment = -0.35; Vol = 62%; Price change 24h = -3.2%",
            },
            {
                "step": 4,
                "thought": "Volume is below the 30-day average inferred from context. Low-volume drops "
                "are less reliable as trend signals. Waiting for volume confirmation is prudent.",
                "evidence": "24h volume = $28.4B (estimated below 30d avg)",
            },
        ],
        "action": "HOLD",
        "conviction": 0.62,
        "rationale_summary": "Elevated volatility and mixed signals across momentum, funding, and sentiment "
        "favour capital preservation over a directional position at this time.",
        "suggested_position_size_pct": 0.0,
        "stop_loss_pct": 5.0,
        "take_profit_pct": 8.0,
    }
    return json.dumps(mock_response)
