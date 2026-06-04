import hashlib
import json

from schema.marketsignal import MarketSignal  # import wrt __main__ (phase1_.. files)


def compute_signal_id(signal: MarketSignal) -> str:
    """
    Deterministically derive a trace_id from the market signal.
    This ties the reasoning irrevocably to the input data.
    """
    canonical = json.dumps(signal.model_dump(), sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()
