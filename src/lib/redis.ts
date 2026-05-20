/**
 * Redis singletons.
 *
 * Two clients live side-by-side because they serve different runtimes:
 *
 *   - `redis` (ioredis, TCP) — used by BullMQ workers and any long-lived
 *     connection (cache, pub/sub). Requires `REDIS_URL`. Do NOT import this
 *     from edge runtime — ioredis depends on `net`.
 *
 *   - `upstash` (REST over HTTPS) — used by `@upstash/ratelimit` and any
 *     edge-callable rate-limiter. Requires `UPSTASH_REDIS_REST_URL` +
 *     `UPSTASH_REDIS_REST_TOKEN`. Edge-safe.
 *
 * In local dev, ioredis points at Docker Compose Redis and the Upstash
 * client is left as a no-op (rate limiting becomes unlimited). In prod,
 * both connect to managed services.
 */
import "server-only";

import IORedis, { type Redis } from "ioredis";
import { Redis as UpstashRedis } from "@upstash/redis";

declare global {
    var __redis: Redis | undefined;

    var __upstash: UpstashRedis | undefined;
}

// ---------------------------------------------------------------------------
// ioredis (BullMQ)
// ---------------------------------------------------------------------------
function createRedis(): Redis {
    const url = process.env.REDIS_URL;
    if (!url) {
        throw new Error(
            "REDIS_URL is not set. Required for BullMQ. " +
                "Run `docker compose up -d` for local dev."
        );
    }
    return new IORedis(url, {
        // BullMQ requires this — it must be able to issue blocking commands.
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        lazyConnect: true,
    });
}

export const redis: Redis = globalThis.__redis ?? createRedis();
if (process.env.NODE_ENV !== "production") {
    globalThis.__redis = redis;
}

// ---------------------------------------------------------------------------
// Upstash REST (rate limiting, edge-callable)
// ---------------------------------------------------------------------------
function createUpstash(): UpstashRedis | null {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) return null;
    return new UpstashRedis({ url, token });
}

export const upstash: UpstashRedis | null = globalThis.__upstash ?? createUpstash();
if (process.env.NODE_ENV !== "production" && upstash) {
    globalThis.__upstash = upstash;
}

/**
 * Returns true if Upstash REST credentials are configured. Used by rate-limit
 * factories to decide whether to enforce the limit or pass-through in dev.
 */
export function hasUpstash(): boolean {
    return upstash !== null;
}
