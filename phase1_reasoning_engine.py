"""
Trading-R1: Phase 1 - AI Reasoning Engine
==========================================
The "Portfolio Manager" agent. Accepts a market signal, calls an LLM,
and forces the output into a strict, verifiable JSON schema.

The reasoning *trace* itself is the product — not the final trade.
"""

import json
import hashlib
import os
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, Field, field_validator
from openai import OpenAI

# ─── Schema Definition ────────────────────────────────────────────────────────

class MarketSignal(BaseModel):
    """Input signal fed to the reasoning engine."""
    asset: str                          # e.g. "BTC/USDC"
    price_usd: float
    price_change_24h_pct: float         # e.g. -3.2 means -3.2%
    volume_24h_usd: float
    volatility_30d: float               # annualised vol e.g. 0.65 = 65%
    rsi_14: float                       # 0-100
    funding_rate: float                 # perp funding, e.g. 0.0001
    sentiment_score: float              # -1.0 (bearish) to +1.0 (bullish)
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class ReasoningTrace(BaseModel):
    """
    The canonical output schema. Every field is required.
    This JSON object is what gets hashed, pinned, and wagered on.
    """
    schema_version: str = "1.0.0"
    trace_id: str                       # deterministic SHA-256 of the signal
    asset: str
    timestamp_utc: str

    # Market regime classification
    regime: Literal["RISK_ON", "RISK_OFF", "NEUTRAL", "HIGH_VOL_UNCERTAIN"]

    # The multi-step reasoning chain (the core product)
    reasoning_trace: list[dict]         # list of {step: int, thought: str, evidence: str}

    # Final decision
    action: Literal["BUY", "SELL", "HOLD"]
    conviction: float = Field(ge=0.0, le=1.0)  # 0.0–1.0
    rationale_summary: str             # one-sentence summary for the marketplace

    # Risk parameters attached to the decision
    suggested_position_size_pct: float  # % of portfolio, e.g. 5.0
    stop_loss_pct: float
    take_profit_pct: float

    @field_validator("reasoning_trace")
    @classmethod
    def must_have_steps(cls, v):
        if len(v) < 3:
            raise ValueError("reasoning_trace must have at least 3 steps")
        return v


# ─── Signal → Trace ID ────────────────────────────────────────────────────────

def compute_signal_id(signal: MarketSignal) -> str:
    """
    Deterministically derive a trace_id from the market signal.
    This ties the reasoning irrevocably to the input data.
    """
    canonical = json.dumps(signal.model_dump(), sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


# ─── Prompt Engineering ───────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are Trading-R1, an institutional-grade quantitative portfolio manager.
Your task is to analyze a market signal and produce a rigorous, multi-step reasoning trace.

CRITICAL: Your ENTIRE response must be a single valid JSON object matching this exact schema:
{
  "schema_version": "1.0.0",
  "trace_id": "<string — will be injected, leave as-is>",
  "asset": "<string>",
  "timestamp_utc": "<ISO8601 string>",
  "regime": "<RISK_ON | RISK_OFF | NEUTRAL | HIGH_VOL_UNCERTAIN>",
  "reasoning_trace": [
    {"step": 1, "thought": "<analytical step>", "evidence": "<data point cited>"},
    {"step": 2, "thought": "...", "evidence": "..."},
    {"step": 3, "thought": "...", "evidence": "..."},
    // minimum 3 steps, maximum 7
  ],
  "action": "<BUY | SELL | HOLD>",
  "conviction": <float 0.0–1.0>,
  "rationale_summary": "<one sentence>",
  "suggested_position_size_pct": <float>,
  "stop_loss_pct": <float>,
  "take_profit_pct": <float>
}

Rules:
- Every reasoning step must cite a specific data point from the signal.
- conviction must reflect genuine uncertainty — avoid 0.9+ unless extremely clear.
- stop_loss_pct and take_profit_pct must be positive floats (e.g. 3.5 = 3.5%).
- Return ONLY the JSON object. No markdown, no explanation outside the JSON.
"""

def build_user_prompt(signal: MarketSignal, trace_id: str) -> str:
    return f"""
Analyze this market signal and produce your reasoning trace:

Asset: {signal.asset}
Current Price: ${signal.price_usd:,.2f}
24h Change: {signal.price_change_24h_pct:+.2f}%
24h Volume: ${signal.volume_24h_usd:,.0f}
30d Annualised Volatility: {signal.volatility_30d * 100:.1f}%
RSI (14): {signal.rsi_14:.1f}
Perpetual Funding Rate: {signal.funding_rate:.4f}
Market Sentiment Score: {signal.sentiment_score:+.2f}  (-1=bearish, +1=bullish)
Signal Timestamp: {signal.timestamp}

Inject this trace_id into your response: {trace_id}
Inject this timestamp_utc into your response: {datetime.now(timezone.utc).isoformat()}
"""


# ─── LLM Call ─────────────────────────────────────────────────────────────────

def call_llm(system: str, user: str) -> str:
    client = OpenAI(
        api_key=os.getenv("GROQ_API_KEY"),
        base_url="https://api.groq.com/openai/v1",  # Groq's OpenAI-compatible endpoint
    )
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",   # or "mixtral-8x7b-32768", "gemma2-9b-it"
        messages=[
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
        temperature=0.2,     # lower = more deterministic JSON output
        max_tokens=2048,
        response_format={"type": "json_object"},  # Groq supports this — forces valid JSON
    )
    return response.choices[0].message.content


def call_llm_mock(system: str, user: str) -> str:
    """
    Deterministic mock — use this for offline testing / CI.
    Returns a valid ReasoningTrace JSON with no API call.
    """
    mock_response = {
        "schema_version": "1.0.0",
        "trace_id": "INJECTED_BY_ENGINE",     # overwritten below
        "asset": "BTC/USDC",
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
        "regime": "HIGH_VOL_UNCERTAIN",
        "reasoning_trace": [
            {
                "step": 1,
                "thought": "RSI at 38.5 is approaching oversold territory but has not confirmed a reversal. "
                           "This suggests selling pressure remains elevated without capitulation.",
                "evidence": "RSI(14) = 38.5; historically BTC bounces occur sub-30"
            },
            {
                "step": 2,
                "thought": "The negative funding rate of -0.0002 indicates short-side dominance in perpetuals. "
                           "Sustained negative funding often precedes squeeze events, but timing is uncertain.",
                "evidence": "Funding rate = -0.0002 (negative = shorts pay longs)"
            },
            {
                "step": 3,
                "thought": "Sentiment at -0.35 is moderately bearish. Combined with a 30d vol of 62%, "
                           "the risk-reward for a directional bet is unfavourable. A HOLD preserves optionality.",
                "evidence": "Sentiment = -0.35; Vol = 62%; Price change 24h = -3.2%"
            },
            {
                "step": 4,
                "thought": "Volume is below the 30-day average inferred from context. Low-volume drops "
                           "are less reliable as trend signals. Waiting for volume confirmation is prudent.",
                "evidence": "24h volume = $28.4B (estimated below 30d avg)"
            }
        ],
        "action": "HOLD",
        "conviction": 0.62,
        "rationale_summary": "Elevated volatility and mixed signals across momentum, funding, and sentiment "
                              "favour capital preservation over a directional position at this time.",
        "suggested_position_size_pct": 0.0,
        "stop_loss_pct": 5.0,
        "take_profit_pct": 8.0
    }
    return json.dumps(mock_response)


# ─── Main Engine ──────────────────────────────────────────────────────────────

def generate_reasoning_trace(
    signal: MarketSignal,
    use_mock: bool = False
) -> tuple[ReasoningTrace, str]:
    """
    Core pipeline:
      MarketSignal → LLM → validated ReasoningTrace + raw JSON string

    Returns:
        (trace: ReasoningTrace, raw_json: str)
    """
    trace_id = compute_signal_id(signal)
    user_prompt = build_user_prompt(signal, trace_id)

    # --- LLM call ---
    llm_fn = call_llm_mock if use_mock else call_llm
    raw_json = llm_fn(SYSTEM_PROMPT, user_prompt)

    # Strip markdown fences if the model added them despite instructions
    raw_json = raw_json.strip().removeprefix("```json").removesuffix("```").strip()

    # --- Parse & validate ---
    data = json.loads(raw_json)
    data["trace_id"] = trace_id          # enforce our deterministic ID
    trace = ReasoningTrace(**data)       # Pydantic validates schema

    # Re-serialise with the corrected trace_id
    canonical_json = trace.model_dump_json(indent=2)

    return trace, canonical_json


# ─── CLI Entry Point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Example market signal
    signal = MarketSignal(
        asset="BTC/USDC",
        price_usd=63_420.50,
        price_change_24h_pct=-3.21,
        volume_24h_usd=28_400_000_000,
        volatility_30d=0.62,
        rsi_14=38.5,
        funding_rate=-0.0002,
        sentiment_score=-0.35,
    )

    print("Market Signal received")
    print(f"Asset: {signal.asset} @ ${signal.price_usd:,.2f}\n")

    # Set use_mock=False and set ANTHROPIC_API_KEY to use the real API
    trace, json_output = generate_reasoning_trace(signal, use_mock=True)

    print("Reasoning Trace generated:")
    print(json_output)
    print(f"\nValidated | Action: {trace.action} | Conviction: {trace.conviction:.0%}")
    print(f"Trace ID: {trace.trace_id}")

    # Save for Phase 2
    with open("trace_output.json", "w") as f:
        f.write(json_output)
    print("\nSaved to trace_output.json")
