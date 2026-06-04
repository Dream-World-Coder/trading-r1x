from typing import Literal

from pydantic import BaseModel, Field, field_validator


class ReasoningTrace(BaseModel):
    """
    The canonical output schema. Every field is required.
    This JSON object is what gets hashed, pinned, and wagered on.
    """

    schema_version: str = "1.0.0"
    trace_id: str  # deterministic SHA-256 of the signal
    asset: str
    timestamp_utc: str

    # Market regime classification
    regime: Literal["RISK_ON", "RISK_OFF", "NEUTRAL", "HIGH_VOL_UNCERTAIN"]

    # The multi-step reasoning chain (the core product)
    reasoning_trace: list[dict]  # list of {step: int, thought: str, evidence: str}

    # Final decision
    action: Literal["BUY", "SELL", "HOLD"]
    conviction: float = Field(ge=0.0, le=1.0)  # 0.0–1.0
    rationale_summary: str  # one-sentence summary for the marketplace

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
