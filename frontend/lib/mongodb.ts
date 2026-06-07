/**
 * lib/mongodb.ts
 * ==============
 * MongoDB connection singleton for Next.js.
 *
 * Uses a module-level cache in dev (so hot-reloads don't open new connections)
 * and a fresh client per cold-start in production (serverless-safe).
 *
 * Env vars:
 *   MONGODB_URI   mongodb+srv://user:pass@cluster.mongodb.net/  (required)
 *   MONGO_DB      trading_r1  (optional, default shown)
 *
 * Note: Python pipeline uses MONGO_URI — add this alias to .env.local:
 *   MONGODB_URI=<same value as MONGO_URI>
 */

import { MongoClient, Db, Collection, Document } from "mongodb";

const uri = process.env.MONGO_URI ?? "";
const dbName = process.env.MONGO_DB ?? "trading_r1";

if (!uri) {
    throw new Error(
        "Missing MONGODB_URI — add it to .env.local:\n" +
            "  MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/",
    );
}

// ─── Dev-mode global cache (survives HMR reloads) ────────────────────────────

declare global {
    // eslint-disable-next-line no-var
    var _mongoClient: MongoClient | undefined;
}

async function getClient(): Promise<MongoClient> {
    if (process.env.NODE_ENV === "development") {
        if (!global._mongoClient) {
            global._mongoClient = new MongoClient(uri);
            await global._mongoClient.connect();
        }
        return global._mongoClient;
    }
    // Production: new client per cold start (connection pooled internally)
    const client = new MongoClient(uri);
    await client.connect();
    return client;
}

// ─── Public helpers ───────────────────────────────────────────────────────────

export async function getDb(): Promise<Db> {
    const client = await getClient();
    return client.db(dbName);
}

export async function getCollection<T extends Document = Document>(
    name: string,
): Promise<Collection<T>> {
    const db = await getDb();
    return db.collection<T>(name);
}
