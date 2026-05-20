/**
 * Application-level Redis cache.
 *
 * Sits on top of the shared `ioredis` client (`@/lib/redis`) and provides:
 *
 *   - `getOrSet<T>(key, ttl, loader)` — read-through with **jittered TTL**
 *     (±10% by default) so a synchronized fleet doesn't all expire the same
 *     key at the same instant.
 *   - **Stale-while-revalidate (SWR)**: each entry is wrapped in
 *     `{ payload, expiresAt }`. We refresh in the background once we cross
 *     `expiresAt`, but keep serving the previous payload until Redis evicts
 *     the key (Redis TTL = `ttl + swrGrace`). A failed loader keeps stale
 *     data alive instead of cascading errors.
 *   - `del(key)` / `delByPattern(pattern)` — invalidation helpers used by
 *     admin save paths.
 *   - `mget` for batched reads (used by the catalogue facet helper).
 *
 * **Failure mode:** if Redis itself is unreachable the cache becomes a
 * pass-through — `loader()` is invoked on every call. Cached helpers must
 * therefore be safe to bypass; we never throw past the `try/catch`.
 *
 * Keys follow the convention `cache:<namespace>:<id>`. Use one of the
 * exported `cacheKey.*` helpers so namespaces stay consistent across
 * readers and invalidators.
 */
import "server-only";

import { redis } from "./redis";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const KEY_PREFIX = "cache:";
/** Extra Redis TTL (seconds) added on top of `ttl` so a stale entry can
 *  still be served for a short window while a refresh runs. */
const DEFAULT_SWR_GRACE_SECONDS = 60;
/** ±jitter ratio applied to the freshness window (default 10%). */
const DEFAULT_JITTER_RATIO = 0.1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Envelope<T> {
    /** Server-set epoch ms after which the value is considered stale. */
    expiresAt: number;
    /** Serialized payload. */
    payload: T;
}

export interface CacheOptions {
    /** Hard TTL in seconds before the value is considered fresh. */
    ttlSeconds: number;
    /** Grace period (seconds) during which stale data is still served while
     *  a background refresh runs. Defaults to 60s. */
    swrGraceSeconds?: number;
    /** Apply ±ratio random jitter to `ttlSeconds`. 0 disables jitter.
     *  Defaults to 0.1 (±10%). */
    jitterRatio?: number;
    /** When true, force a refresh and overwrite the cached value. */
    bypass?: boolean;
}

export type Loader<T> = () => Promise<T>;

// ---------------------------------------------------------------------------
// Key helpers — keep namespaces in one place
// ---------------------------------------------------------------------------
export const cacheKey = {
    settings: (group?: string) => `settings:${group ?? "all"}`,
    bookingSettings: () => "settings:booking",
    activeCategories: () => "categories:active",
    productFacets: (filterHash = "all") => `products:facets:${filterHash}`,
    nav: () => "site:nav",
    footer: () => "site:footer",
    /** Free-form custom key (caller is responsible for collision-safety). */
    custom: (suffix: string) => suffix,
};

// ---------------------------------------------------------------------------
// Background-refresh deduplication — multiple concurrent SWR triggers for
// the same key share a single in-flight loader so we don't stampede the
// upstream during a TTL boundary.
// ---------------------------------------------------------------------------
declare global {
    var __cacheInflight: Map<string, Promise<unknown>> | undefined;
}
const inflight: Map<string, Promise<unknown>> = globalThis.__cacheInflight ??
new Map<string, Promise<unknown>>();
if (process.env.NODE_ENV !== "production") {
    globalThis.__cacheInflight = inflight;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function fullKey(namespace: string): string {
    return `${KEY_PREFIX}${namespace}`;
}

/** Apply ±ratio jitter to an integer-second TTL. Always returns ≥ 1. */
export function jitter(ttlSeconds: number, ratio = DEFAULT_JITTER_RATIO): number {
    if (ratio <= 0) return Math.max(1, Math.round(ttlSeconds));
    const delta = ttlSeconds * ratio;
    const offset = (Math.random() * 2 - 1) * delta; // [-delta, +delta]
    return Math.max(1, Math.round(ttlSeconds + offset));
}

async function safeRead<T>(key: string): Promise<Envelope<T> | null> {
    try {
        const raw = await redis.get(key);
        if (!raw) return null;
        return JSON.parse(raw) as Envelope<T>;
    } catch (err) {
        console.warn("[cache] redis read failed for", key, err);
        return null;
    }
}

async function safeWrite<T>(key: string, env: Envelope<T>, redisTtlSeconds: number): Promise<void> {
    try {
        await redis.set(key, JSON.stringify(env), "EX", Math.max(1, redisTtlSeconds));
    } catch (err) {
        console.warn("[cache] redis write failed for", key, err);
    }
}

/**
 * Run `loader()` once per key while in-flight, persist the result, return it.
 * Concurrent callers waiting on the same key share the same promise.
 */
async function refresh<T>(
    key: string,
    loader: Loader<T>,
    ttlSeconds: number,
    swrGraceSeconds: number,
    jitterRatio: number
): Promise<T> {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const promise = (async () => {
        try {
            const value = await loader();
            const ttl = jitter(ttlSeconds, jitterRatio);
            const env: Envelope<T> = {
                expiresAt: Date.now() + ttl * 1000,
                payload: value,
            };
            await safeWrite(key, env, ttl + swrGraceSeconds);
            return value;
        } finally {
            inflight.delete(key);
        }
    })();

    inflight.set(key, promise);
    return promise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Read-through cache with jittered TTL and stale-while-revalidate.
 *
 *   - Cache hit & fresh → return payload, no work.
 *   - Cache hit & stale → return payload, fire background refresh.
 *   - Cache miss        → run loader, persist, return.
 *   - Loader throws     → propagates (cache miss); stale path swallows
 *                          the error and keeps serving the stale value.
 */
export async function getOrSet<T>(
    namespace: string,
    options: CacheOptions,
    loader: Loader<T>
): Promise<T> {
    const key = fullKey(namespace);
    const ttl = Math.max(1, options.ttlSeconds);
    const swrGrace = options.swrGraceSeconds ?? DEFAULT_SWR_GRACE_SECONDS;
    const jitterRatio = options.jitterRatio ?? DEFAULT_JITTER_RATIO;

    if (!options.bypass) {
        const env = await safeRead<T>(key);
        if (env) {
            const isFresh = env.expiresAt > Date.now();
            if (isFresh) return env.payload;
            // Stale — serve cached and refresh in the background.
            void refresh(key, loader, ttl, swrGrace, jitterRatio).catch((err) => {
                console.warn("[cache] background refresh failed for", key, err);
            });
            return env.payload;
        }
    }

    // Cache miss (or bypass). Loader errors propagate.
    return refresh(key, loader, ttl, swrGrace, jitterRatio);
}

/** Drop a single cache entry. */
export async function del(namespace: string): Promise<void> {
    try {
        await redis.del(fullKey(namespace));
    } catch (err) {
        console.warn("[cache] redis del failed for", namespace, err);
    }
}

/** Drop several entries in one round-trip. */
export async function delMany(namespaces: readonly string[]): Promise<void> {
    if (namespaces.length === 0) return;
    try {
        await redis.del(...namespaces.map(fullKey));
    } catch (err) {
        console.warn("[cache] redis del-many failed", err);
    }
}

/**
 * Drop every key matching a glob pattern. Uses `SCAN` so it's safe on large
 * keyspaces. Pattern is automatically prefixed with `cache:`.
 *
 *   delByPattern("settings:*")
 */
export async function delByPattern(pattern: string): Promise<number> {
    const fullPattern = fullKey(pattern);
    let cursor = "0";
    let removed = 0;
    try {
        do {
            const [next, batch] = await redis.scan(cursor, "MATCH", fullPattern, "COUNT", 100);
            cursor = next;
            if (batch.length > 0) {
                removed += await redis.del(...batch);
            }
        } while (cursor !== "0");
    } catch (err) {
        console.warn("[cache] redis scan/del failed for", pattern, err);
    }
    return removed;
}

/**
 * Batched read for caches whose entries can be safely served stale.
 * Returns an array aligned with `namespaces`; missing / unparsable entries
 * become `null`.
 */
export async function mget<T>(namespaces: readonly string[]): Promise<(T | null)[]> {
    if (namespaces.length === 0) return [];
    try {
        const keys = namespaces.map(fullKey);
        const raws = await redis.mget(...keys);
        return raws.map((raw) => {
            if (!raw) return null;
            try {
                const env = JSON.parse(raw) as Envelope<T>;
                return env.payload ?? null;
            } catch {
                return null;
            }
        });
    } catch (err) {
        console.warn("[cache] redis mget failed", err);
        return namespaces.map(() => null);
    }
}

// ---------------------------------------------------------------------------
// Test hooks — exported for unit tests, not part of the public surface.
// ---------------------------------------------------------------------------
export const __testing__ = {
    KEY_PREFIX,
    DEFAULT_SWR_GRACE_SECONDS,
    DEFAULT_JITTER_RATIO,
    fullKey,
    inflight,
};
