"""
Trading-R1: Phase 1 - AI Reasoning Engine
==========================================
The "Portfolio Manager" agent. Accepts a market signal, calls an LLM,
and forces the output into a strict, verifiable JSON schema.

The reasoning *trace* itself is the product — not the final trade.
"""

import json
import os
from datetime import datetime, timezone

from openai import OpenAI

from schema.marketsignal import MarketSignal
from schema.reasoningtrace import ReasoningTrace
from utils.hash import compute_signal_id
from utils.mock import call_llm_mock
from utils.prompts import SYSTEM_PROMPT


# Signal → Trace ID
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


def call_llm(system: str, user: str) -> str:
    client = OpenAI(
        api_key=os.getenv("GROQ_API_KEY"),
        base_url="https://api.groq.com/openai/v1",
    )
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",  # "mixtral-8x7b-32768", "gemma2-9b-it"
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.2,  # lower = more deterministic JSON output
        max_tokens=2048,
        response_format={
            "type": "json_object"
        },  # Groq supports this — forces valid JSON
    )
    return response.choices[0].message.content


def generate_reasoning_trace(
    signal: MarketSignal, use_mock: bool = False
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
    data["trace_id"] = trace_id  # enforce our deterministic ID
    trace = ReasoningTrace(**data)  # Pydantic validates schema

    # Re-serialise with the corrected trace_id
    canonical_json = trace.model_dump_json(indent=2)

    return trace, canonical_json


def main():
    # eg market signal
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

    trace, json_output = generate_reasoning_trace(signal, use_mock=False)

    # verify output -> !semgrep
    # Each step in reasoning_trace must cite a specific data point from the input signal as evidence. This forces the model to ground its reasoning in the actual numbers, not generic market commentary.
    # if not, raise error

    print("Reasoning Trace generated:")
    print(json_output)
    print(f"\nValidated | Action: {trace.action} | Conviction: {trace.conviction:.0%}")
    print(f"Trace ID: {trace.trace_id}")

    # Save for Phase 2
    with open("trace_output.json", "w") as f:
        f.write(json_output)
    print("\nSaved to trace_output.json")


if __name__ == "__main__":
    main()
