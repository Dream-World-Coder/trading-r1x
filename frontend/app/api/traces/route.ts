/**
 * app/api/traces/route.ts
 * =======================
 * GET /api/traces
 *
 * Returns all pipeline receipts from MongoDB, newest first.
 * Replaces the MOCK_TRACES array in page.tsx.
 *
 * Response shape (array of ApiTrace):
 * {
 *   traces: ApiTrace[]
 *   count:  number
 * }
 *
 * Missing fields from MongoDB docs (not stored in PipelineReceipt):
 *   regime      — lives in the IPFS ReasoningTrace JSON, not in receipt.
 *                 Fetch from IPFS in the detail page (trace/[hash]/page.tsx).
 *                 Returns "" here.
 *   rationale   — same as above, returns "".
 *   profitPool  — on-chain only; not stored in MongoDB. Returns "0".
 *   lossPool    — on-chain only; not stored in MongoDB. Returns "0".
 *
 * To enrich these fields without IPFS calls, add regime + rationale_summary
 * to PipelineReceipt in pipeline_orchestrator.py and re-run the pipeline.
 */

import { NextResponse } from "next/server";
import { getCollection } from "@/lib/mongodb";

// ─── Document shape as stored by ReceiptStore._to_mongo_doc ──────────────────

interface ReceiptDoc {
    _id: string; // = trace_id
    asset: string;
    action: "BUY" | "SELL" | "HOLD";
    conviction: number;
    data_source: string;
    sha256_hex: string;
    ipfs_cid: string;
    ipfs_url: string;
    tx_hash: string;
    block_number: number;
    contract_address: string;
    waging_deadline: string; // ISO UTC string
    resolution_deadline: string; // ISO UTC string
    registered_at_utc: string; // ISO UTC string
    status: "open" | "resolved";
    created_at: Date; // BSON Date — used for sorting
    waging_deadline_dt: Date;
    resolution_deadline_dt: Date;
}

// ─── Response shape consumed by page.tsx ─────────────────────────────────────

export interface ApiTrace {
    hash: string; // trace_id (_id in Mongo)
    asset: string;
    action: "BUY" | "SELL" | "HOLD";
    conviction: number;
    regime: string; // "" until fetched from IPFS
    rationale: string; // "" until fetched from IPFS
    ipfsCid: string;
    ipfsUrl: string;
    txHash: string;
    blockNumber: number;
    contractAddress: string;
    wagingDeadline: number; // unix timestamp (seconds)
    resolutionDeadline: number; // unix timestamp (seconds)
    registeredAt: string; // ISO UTC
    dataSource: string;
    status: "open" | "resolved";
    // On-chain pool sizes — returned as strings (BigInt can't JSON-serialize).
    // Convert to BigInt on the client: BigInt(trace.profitPool)
    profitPool: string; // "0" until on-chain read
    lossPool: string; // "0" until on-chain read
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function GET() {
    try {
        const col = await getCollection<ReceiptDoc>("receipts");

        const docs = await col
            .find({})
            .sort({ created_at: -1 }) // newest first
            .toArray();

        const traces: ApiTrace[] = docs.map((doc) => ({
            hash: doc._id,
            asset: doc.asset,
            action: doc.action,
            conviction: doc.conviction,
            regime: "", // enrich from IPFS in detail page
            rationale: "", // enrich from IPFS in detail page
            ipfsCid: doc.ipfs_cid,
            ipfsUrl: doc.ipfs_url,
            txHash: doc.tx_hash,
            blockNumber: doc.block_number,
            contractAddress: doc.contract_address,
            wagingDeadline: isoToUnix(doc.waging_deadline),
            resolutionDeadline: isoToUnix(doc.resolution_deadline),
            registeredAt: doc.registered_at_utc,
            dataSource: doc.data_source,
            status: doc.status ?? "open",
            profitPool: "0",
            lossPool: "0",
        }));

        return NextResponse.json({ traces, count: traces.length });
    } catch (err) {
        console.error("[GET /api/traces]", err);
        return NextResponse.json(
            { error: "Failed to fetch traces from database" },
            { status: 500 },
        );
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoToUnix(iso: string): number {
    return Math.floor(new Date(iso).getTime() / 1000);
}
