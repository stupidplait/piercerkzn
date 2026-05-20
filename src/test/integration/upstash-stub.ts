/**
 * In-memory stub for `@upstash/ratelimit`, used by integration and property
 * tests that exercise the rate-limit composition in `lib/rate-limit.ts` and
 * the per-user / per-IP gating in `lib/api.ts`.
 *
 * The stub replaces the real `Ratelimit` class with a `Map`-backed
 * sliding-window implementation that:
 *
 *   1. Mirrors the subset of the upstream `@upstash/ratelimit` surface that
 *      `lib/rate-limit.ts` actually consumes — namely
 *      `new Ratelimit({ redis, limiter, prefix?, analytics?, ... })`,
 *      the static `Ratelimit.slidingWindow(limit, window)` factory, and the
 *      instance method `limiter.limit(identifier)` returning
 *      `{ success, limit, remaining, reset, pending }`.
 *
 *   2. Stores each bucket as `{ count: number; reset: number }` in a
 *      module-level `Map<string, BucketState>`, keyed by `${prefix}:${identifier}`.
 *      A call advances the bucket: if the window has elapsed
 *      (`now >= bucket.reset`), a fresh window starts (`count = 1`,
 *      `reset = now + windowMs`); otherwise the count is incremented and
 *      the existing `reset` timestamp is preserved. `success` is
 *      `count <= limit`. This is a deterministic, time-source-controllable
 *      analogue of Upstash's sliding-window semantics — sufficient for the
 *      admit/deny assertions integration tests need.
 *
 *   3. Records every `.limit(...)` invocation in an in-memory call log so
 *      tests can assert (per Requirements 5.4 and 5.5):
 *         - "no `u:`-prefixed writes occurred" — `hadUserPrefixWrites()`.
 *         - "exactly one increment per consulted bucket" —
 *           `callCountFor(prefix, identifier)` and `getCalledIdentifiers()`.
 *
 * Wiring into a test file:
 *
 *   vi.mock("@upstash/ratelimit", () =>
 *       import("@/test/integration/upstash-stub")
 *   );
 *
 *   import {
 *       resetUpstashStub,
 *       setUpstashStubClock,
 *       getUpstashCalls,
 *       hadUserPrefixWrites,
 *       callCountFor,
 *   } from "@/test/integration/upstash-stub";
 *
 *   beforeEach(() => resetUpstashStub());
 *
 * The stub does not import `server-only`, `next-auth`, or any Node-only
 * APIs — it is safe to use under both the unit and integration vitest
 * configs, and from the edge-runtime middleware tests.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Window string accepted by `Ratelimit.slidingWindow`, matching the upstream
 * type and the `windowSchema` regex in `lib/env.ts`.
 */
export type Window = `${number} ${"s" | "m" | "h" | "d"}`;

/**
 * Per-bucket state stored in the in-memory `Map`. Mirrors the shape called
 * out by task 5.3.
 */
export interface BucketState {
    /** Number of admitted+denied calls observed inside the current window. */
    count: number;
    /** Unix ms timestamp at which the current window resets (bucket clears). */
    reset: number;
}

/**
 * Subset of `RatelimitResponse` that `lib/rate-limit.ts` reads. The full
 * upstream type also exposes `reason`, `deniedValue`, etc. — none of which
 * are consumed today, so they are omitted here.
 */
export interface RatelimitResponse {
    success: boolean;
    limit: number;
    remaining: number;
    reset: number;
    pending: Promise<unknown>;
}

/**
 * Marker object returned by `Ratelimit.slidingWindow(limit, window)`. The
 * stub inspects this in the `Ratelimit` constructor to recover the limit
 * and window-ms; the real package returns an `Algorithm<TContext>` closure
 * that we do not need to mimic here.
 */
export interface AlgorithmMarker {
    readonly kind: "slidingWindow";
    readonly limit: number;
    readonly windowMs: number;
}

/**
 * Mirrors the subset of `RatelimitConfig<Context>` that `lib/rate-limit.ts`
 * passes today. Extra fields are accepted and ignored to preserve forward
 * compatibility with future upstream additions.
 */
export interface RatelimitConfig {
    redis?: unknown;
    limiter: AlgorithmMarker;
    prefix?: string;
    analytics?: boolean;
    timeout?: number;
    ephemeralCache?: unknown;
    enableProtection?: boolean;
    denyListThreshold?: number;
}

/**
 * Single recorded `.limit(identifier)` invocation. Tests use these records
 * to assert spy properties (no `u:` writes, exactly-one increment, etc.).
 */
export interface CallRecord {
    /** Full Redis-style key formed as `${prefix}:${identifier}`. */
    key: string;
    /** Bare identifier passed to `.limit(...)` (e.g. `"ip:1.2.3.4"` or `"u:42"`). */
    identifier: string;
    /** Prefix configured on the `Ratelimit` instance the call hit. */
    prefix: string;
    /** Snapshot of the response returned by the call. */
    result: Omit<RatelimitResponse, "pending">;
    /** Wall-clock (or controlled-clock) time at which the call was made. */
    at: number;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const STORE = new Map<string, BucketState>();
const CALLS: CallRecord[] = [];
let NOW: () => number = () => Date.now();

const DEFAULT_PREFIX = "@upstash/ratelimit";

// ---------------------------------------------------------------------------
// Window parsing
// ---------------------------------------------------------------------------

const UNIT_TO_MS: Record<"s" | "m" | "h" | "d", number> = {
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
};

/**
 * Convert a `"<n> s|m|h|d"` window string into milliseconds. The regex
 * matches the same shape `lib/env.ts` validates with `windowSchema`.
 *
 * Exported so tests that need to assert reset arithmetic can reuse the
 * same conversion the stub itself does.
 */
export function parseWindow(window: Window): number {
    const match = /^(\d+)\s+([smhd])$/.exec(window);
    if (!match) {
        throw new Error(`[upstash-stub] invalid window string: ${JSON.stringify(window)}`);
    }
    const n = Number(match[1]);
    const unit = match[2] as "s" | "m" | "h" | "d";
    return n * UNIT_TO_MS[unit];
}

// ---------------------------------------------------------------------------
// `Ratelimit` stub class
// ---------------------------------------------------------------------------

/**
 * Drop-in for `@upstash/ratelimit`'s `Ratelimit` class, scoped to the
 * subset `lib/rate-limit.ts` exercises today.
 *
 * Construction reads `limit` and `windowMs` from the `AlgorithmMarker`
 * produced by `Ratelimit.slidingWindow(...)`. The instance's `prefix` is
 * used to form the `Map` key; identifiers passed to `.limit(...)` are
 * recorded verbatim so tests can assert against the `"ip:"` / `"u:"`
 * namespaces declared in design §1.
 */
export class Ratelimit {
    public readonly prefix: string;
    public readonly limitMax: number;
    public readonly windowMs: number;

    /**
     * Static factory — the marker is read in the constructor. The real
     * package returns an algorithm closure; we return a plain object the
     * stub knows how to introspect.
     */
    public static slidingWindow(limit: number, window: Window): AlgorithmMarker {
        return Object.freeze({
            kind: "slidingWindow" as const,
            limit,
            windowMs: parseWindow(window),
        });
    }

    constructor(config: RatelimitConfig) {
        if (!config || !config.limiter || config.limiter.kind !== "slidingWindow") {
            // Tests that hit a non-slidingWindow algorithm marker indicate a
            // contract drift in `lib/rate-limit.ts`; fail loudly so the
            // mismatch surfaces in CI rather than silently no-oping.
            throw new Error(
                "[upstash-stub] Ratelimit constructor expected a slidingWindow algorithm marker"
            );
        }
        this.prefix = config.prefix ?? DEFAULT_PREFIX;
        this.limitMax = config.limiter.limit;
        this.windowMs = config.limiter.windowMs;
    }

    /**
     * Mirror of `Ratelimit.limit(identifier, opts?)`. Bound as an arrow so
     * destructured invocations (`const { limit } = ratelimit; limit(id)`)
     * — which the upstream package supports — keep working.
     */
    public limit = async (identifier: string, _opts?: unknown): Promise<RatelimitResponse> => {
        const now = NOW();
        const key = `${this.prefix}:${identifier}`;
        const existing = STORE.get(key);

        let next: BucketState;
        if (!existing || existing.reset <= now) {
            // New window: bucket has expired (or never existed). Start fresh.
            next = { count: 1, reset: now + this.windowMs };
        } else {
            // Same window: increment but keep the original reset timestamp,
            // so callers see a monotonically non-increasing time-to-reset
            // across consecutive calls (Requirement 5.6).
            next = { count: existing.count + 1, reset: existing.reset };
        }
        STORE.set(key, next);

        const success = next.count <= this.limitMax;
        const remaining = Math.max(0, this.limitMax - next.count);
        const result: RatelimitResponse = {
            success,
            limit: this.limitMax,
            remaining,
            reset: next.reset,
            // The real package exposes a `pending` promise for analytics
            // flushing; tests don't await it, but we expose a settled
            // promise so `void r.pending` still works.
            pending: Promise.resolve(),
        };

        CALLS.push({
            key,
            identifier,
            prefix: this.prefix,
            result: {
                success: result.success,
                limit: result.limit,
                remaining: result.remaining,
                reset: result.reset,
            },
            at: now,
        });

        return result;
    };

    /**
     * `lib/rate-limit.ts` does not call `getRemaining`/`resetUsedTokens`,
     * but they exist on the upstream class. We provide minimal stand-ins
     * so future code paths that reach for them get a sensible response
     * instead of `undefined is not a function`.
     */
    public getRemaining = async (
        identifier: string
    ): Promise<{ remaining: number; reset: number; limit: number }> => {
        const now = NOW();
        const key = `${this.prefix}:${identifier}`;
        const existing = STORE.get(key);
        if (!existing || existing.reset <= now) {
            return { remaining: this.limitMax, reset: 0, limit: this.limitMax };
        }
        return {
            remaining: Math.max(0, this.limitMax - existing.count),
            reset: existing.reset,
            limit: this.limitMax,
        };
    };

    public resetUsedTokens = async (identifier: string): Promise<void> => {
        STORE.delete(`${this.prefix}:${identifier}`);
    };
}

// ---------------------------------------------------------------------------
// Test seam helpers
// ---------------------------------------------------------------------------

/**
 * Reset the in-memory store, the call log, and the controlled clock. Call
 * from `beforeEach` to keep tests isolated.
 */
export function resetUpstashStub(): void {
    STORE.clear();
    CALLS.length = 0;
    NOW = () => Date.now();
}

/**
 * Install a controlled clock used by every `Ratelimit.limit` call. Tests
 * that need to assert `Retry-After` arithmetic or window expiry advance
 * the returned closure between calls; pass `() => Date.now()` (or call
 * `resetUpstashStub`) to restore the real clock.
 *
 * Example:
 *   let now = 1_000_000;
 *   setUpstashStubClock(() => now);
 *   ...
 *   now += 60_000; // advance one minute
 */
export function setUpstashStubClock(clock: () => number): void {
    NOW = clock;
}

/** Read-only snapshot of the call log, in invocation order. */
export function getUpstashCalls(): readonly CallRecord[] {
    return CALLS.slice();
}

/**
 * Identifiers passed to `.limit(...)` since the last reset, in invocation
 * order. Convenience wrapper around `getUpstashCalls()` for the common
 * "did the right key get touched?" assertion.
 */
export function getCalledIdentifiers(): readonly string[] {
    return CALLS.map((c) => c.identifier);
}

/**
 * Predicate: did any recorded call touch a `"u:"`-prefixed identifier?
 *
 * Backs Requirement 5.4: anonymous `applyRateLimit` calls SHALL never
 * write a per-user bucket.
 */
export function hadUserPrefixWrites(): boolean {
    return CALLS.some((c) => c.identifier.startsWith("u:"));
}

/**
 * Count `.limit(...)` invocations against a specific `(prefix, identifier)`
 * pair. Backs the "exactly one increment per consulted bucket" assertion
 * called out in Requirements 5.1 and 5.5.
 */
export function callCountFor(prefix: string, identifier: string): number {
    return CALLS.filter((c) => c.prefix === prefix && c.identifier === identifier).length;
}

/**
 * Read the current bucket state (or `null` if untouched / expired) for a
 * given `(prefix, identifier)`. Useful for asserting bucket independence
 * across distinct identifiers (Requirements 5.2 and 5.3).
 */
export function getBucketState(prefix: string, identifier: string): BucketState | null {
    const state = STORE.get(`${prefix}:${identifier}`);
    if (!state) return null;
    return { count: state.count, reset: state.reset };
}

/**
 * Read-only view of every active bucket. Tests use this to assert global
 * properties such as "no key starts with `u:`" or "every key is in the
 * known prefix set".
 */
export function getStoreSnapshot(): ReadonlyMap<string, BucketState> {
    return new Map(STORE);
}
