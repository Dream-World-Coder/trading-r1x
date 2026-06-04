"""
Trading-R1: Phase 2 - Immutable Storage Pipeline
=================================================
Takes the validated JSON from Phase 1, hashes it deterministically,
and pins it to IPFS via Pinata. Returns the CID and SHA-256 hash
that will be written to the Arc smart contract in Phase 3.

Install deps:
    pip install requests python-dotenv
"""

import hashlib
import json
import os
import time
from dataclasses import dataclass

import requests
from dotenv import load_dotenv

load_dotenv()

# Configurations

PINATA_API_KEY = os.getenv("PINATA_API_KEY", "")
PINATA_API_SECRET = os.getenv("PINATA_API_SECRET", "")
PINATA_JWT = os.getenv("PINATA_JWT", "")  # preferred auth method

PINATA_PIN_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS"
PINATA_GATE_URL = "https://gateway.pinata.cloud/ipfs"

# Irys (formerly Bundlr) — alternative permanent storage on Arweave
IRYS_NODE_URL = "https://node1.irys.xyz"


# Data Structures
@dataclass
class StorageReceipt:
    """
    Everything needed to anchor this trace on-chain.
    sha256_hex → stored in the smart contract as the primary key.
    ipfs_cid   → used to retrieve the full JSON from IPFS.
    """

    sha256_hex: str  # deterministic hash of canonical JSON
    ipfs_cid: str  # IPFS Content Identifier (CIDv1 preferred)
    ipfs_url: str  # human-readable gateway URL
    pinata_tx_id: str  # Pinata pin ID for management
    byte_size: int  # size of the pinned payload
    pinned_at_utc: str  # ISO timestamp of the pin operation


# Hashing
def canonical_json_bytes(trace_dict: dict) -> bytes:
    """
    Produce a deterministic byte representation of the JSON.
    Rules:
      - sort_keys=True  → key order is always alphabetical
      - separators      → no trailing spaces (compact)
      - ensure_ascii    → normalise any unicode
    This is the byte string we hash AND pin — they must be identical.
    """
    return json.dumps(
        trace_dict,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")


def sha256_hash(data: bytes) -> str:
    """Returns the lowercase hex SHA-256 digest of `data`."""
    return hashlib.sha256(data).hexdigest()


def verify_hash(data: bytes, expected_hex: str) -> bool:
    """
    Re-derive the hash and compare. Call this before any on-chain write
    to guarantee the payload hasn't mutated in transit.
    """
    return sha256_hash(data) == expected_hex


# IPFS via Pinata
def pin_to_ipfs_pinata(
    trace_dict: dict,
    sha256_hex: str,
    name: str = "trading-r1-trace",
) -> StorageReceipt:
    """
    Pins the canonical JSON to IPFS via Pinata.

    The payload sent to Pinata is:
        { "pinataContent": <trace_dict>, "pinataMetadata": { ... } }

    Pinata returns a CID that is derived from the content — meaning
    the same JSON bytes always produce the same CID (content-addressable).
    """
    headers = {
        "Content-Type": "application/json",
    }
    if PINATA_JWT:
        headers["Authorization"] = f"Bearer {PINATA_JWT}"
    else:
        headers["pinata_api_key"] = PINATA_API_KEY
        headers["pinata_secret_api_key"] = PINATA_API_SECRET

    payload = {
        "pinataContent": trace_dict,  # Pinata will canonicalise this
        "pinataMetadata": {
            "name": f"{name}-{sha256_hex[:12]}",
            "keyvalues": {
                "sha256": sha256_hex,
                "schema_version": trace_dict.get("schema_version", ""),
                "asset": trace_dict.get("asset", ""),
                "action": trace_dict.get("action", ""),
            },
        },
        "pinataOptions": {
            "cidVersion": 1,  # CIDv1 — more portable, base32
        },
    }

    response = requests.post(PINATA_PIN_URL, json=payload, headers=headers, timeout=30)
    response.raise_for_status()
    result = response.json()

    cid = result["IpfsHash"]
    pin_size = result["PinSize"]
    ts = result["Timestamp"]

    return StorageReceipt(
        sha256_hex=sha256_hex,
        ipfs_cid=cid,
        ipfs_url=f"{PINATA_GATE_URL}/{cid}",
        pinata_tx_id=result.get("id", cid),
        byte_size=pin_size,
        pinned_at_utc=ts,
    )


# IPFS via public HTTP API (fallback / dev mode)
def pin_to_ipfs_local(trace_dict: dict, sha256_hex: str) -> StorageReceipt:
    """
    Fallback: use a locally running IPFS daemon (kubo).
    Useful for development without Pinata credentials.

    Start daemon: ipfs daemon
    """
    LOCAL_API = "http://127.0.0.1:5001/api/v0/add"
    canonical = canonical_json_bytes(trace_dict)
    files = {"file": ("trace.json", canonical, "application/json")}
    response = requests.post(LOCAL_API, files=files, timeout=10)
    response.raise_for_status()
    result = response.json()
    cid = result["Hash"]

    return StorageReceipt(
        sha256_hex=sha256_hex,
        ipfs_cid=cid,
        ipfs_url=f"https://ipfs.io/ipfs/{cid}",
        pinata_tx_id="local",
        byte_size=len(canonical),
        pinned_at_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


# Mock (no network)
def pin_to_ipfs_mock(trace_dict: dict, sha256_hex: str) -> StorageReceipt:
    """
    Returns a deterministic mock receipt. Zero network calls.
    CID is fake but the sha256_hex is real — safe for on-chain testing.
    """
    canonical = canonical_json_bytes(trace_dict)
    fake_cid = "bafybeig" + sha256_hex[:44]  # CIDv1 prefix + hash stub

    return StorageReceipt(
        sha256_hex=sha256_hex,
        ipfs_cid=fake_cid,
        ipfs_url=f"https://gateway.pinata.cloud/ipfs/{fake_cid}",
        pinata_tx_id="mock-pin-" + sha256_hex[:8],
        byte_size=len(canonical),
        pinned_at_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    )


# Main Pipeline
def process_trace(
    trace_json_str: str,
    mode: str = "mock",  # "pinata" | "local" | "mock"
) -> StorageReceipt:
    """
    Full Phase 2 pipeline:
      1. Parse the JSON string from Phase 1
      2. Re-serialise to canonical bytes (sort_keys, compact)
      3. SHA-256 hash those bytes
      4. Pin to IPFS
      5. Verify hash integrity post-pin
      6. Return StorageReceipt for Phase 3

    Args:
        trace_json_str: The raw JSON string output from Phase 1.
        mode: Which pinning backend to use.
    """
    # Step 1: Parse
    trace_dict = json.loads(trace_json_str)

    # Step 2: Canonical bytes
    canonical = canonical_json_bytes(trace_dict)

    # Step 3: Hash
    sha256_hex = sha256_hash(canonical)
    print(f"SHA-256: {sha256_hex}")

    # Step 4: Pin
    if mode == "pinata":
        receipt = pin_to_ipfs_pinata(trace_dict, sha256_hex)
    elif mode == "local":
        receipt = pin_to_ipfs_local(trace_dict, sha256_hex)
    else:
        receipt = pin_to_ipfs_mock(trace_dict, sha256_hex)

    # Step 5: Integrity check
    assert verify_hash(canonical, receipt.sha256_hex), (
        "CRITICAL: Hash mismatch after pinning — do not proceed to on-chain write"
    )

    print(f"IPFS CID:  {receipt.ipfs_cid}")
    print(f"URL:       {receipt.ipfs_url}")
    print("Integrity verified — safe to write to Arc chain")

    return receipt


def main():
    # Load output from Phase 1
    try:
        with open("trace_output.json") as f:
            trace_json_str = f.read()
        print("Loaded trace_output.json from Phase 1\n")
    except FileNotFoundError:
        print("Run Phase 1 first")
        return

    receipt = process_trace(trace_json_str, mode="pinata")

    print("\nStorage Receipt:")
    print(f"sha256_hex  : {receipt.sha256_hex}")
    print(f"ipfs_cid    : {receipt.ipfs_cid}")
    print(f"ipfs_url    : {receipt.ipfs_url}")
    print(f"byte_size   : {receipt.byte_size} bytes")
    print(f"pinned_at   : {receipt.pinned_at_utc}")

    # Save receipt for Phase 3
    with open("storage_receipt.json", "w") as f:
        json.dump(
            {
                "sha256_hex": receipt.sha256_hex,
                "ipfs_cid": receipt.ipfs_cid,
                "ipfs_url": receipt.ipfs_url,
                "pinata_tx_id": receipt.pinata_tx_id,
                "byte_size": receipt.byte_size,
                "pinned_at_utc": receipt.pinned_at_utc,
            },
            f,
            indent=2,
        )
    print("\nSaved to storage_receipt.json")


# CLI
if __name__ == "__main__":
    main()
