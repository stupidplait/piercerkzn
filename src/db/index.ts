/**
 * Drizzle ORM client — singleton pattern to prevent connection pool exhaustion
 * during Next.js hot reloads in development.
 *
 * Uses the pooler URL (Neon PgBouncer / Upstash) when available, falling back
 * to the direct URL. In serverless environments, max=1 is critical.
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
    var __pgClient: postgres.Sql | undefined;
}

function createClient(): postgres.Sql {
    const url = process.env.DATABASE_URL_POOLER ?? process.env.DATABASE_URL;
    if (!url) {
        throw new Error(
            "DATABASE_URL is not set. " +
                "Copy .env.example to .env.local and fill in the database credentials."
        );
    }
    return postgres(url, {
        max: 1, // Critical for serverless: one connection per function invocation
        idle_timeout: 20,
        max_lifetime: 60 * 30,
        connect_timeout: 10,
    });
}

// Reuse across hot reloads in development; create fresh in production
const client = globalThis.__pgClient ?? createClient();
if (process.env.NODE_ENV !== "production") {
    globalThis.__pgClient = client;
}

export const db = drizzle(client, { schema });

export type DB = typeof db;

// Re-export schema so consumers can do: import { db, customers } from "@/db"
export * from "./schema";
