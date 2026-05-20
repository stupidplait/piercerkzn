/**
 * Per-route rate limiters built on `@upstash/ratelimit`.
 *
 * Each limiter is lazy-instantiated so this module can be imported in dev
 * without `UPSTASH_REDIS_REST_*` credentials. When credentials are missing
 * the `check()` helper returns `{ success: true }` — i.e. rate limiting is
 * effectively disabled in local dev. Production deploys MUST set both env
 * vars; a startup health check should assert this.
 *
 * Identifier strategy:
 *   - `byIp(req)`         — IP from x-forwarded-for / cf-connecting-ip
 *   - `byUserId(userId)`  — when caller is authenticated (key prefix `"u:"`)
 *
 * Rate-limit composition (per-IP × per-user):
 *   - Some kinds (`contact`, `reservation`) have a per-user counterpart
 *     (`contact_user`, `reservation_user`) listed in {@link PER_USER_KIND}.
 *     `applyRateLimit` (in `lib/api.ts`) consults BOTH buckets when the
 *     request is authenticated, and admits only when both admit. The
 *     per-user limits are intentionally ≥ 3× the per-IP limits so that
 *     legitimate authenticated users on a shared NAT IP are not capped
 *     tighter than anonymous traffic on the same form.
 *   - Other kinds (`auth`, `booking`, `upload`) have no per-user counterpart
 *     by design (login is unauthenticated; booking keys at the appointment
 *     layer; upload is admin-only).
 *
 * Bypass:
 *   - `isBypassPath(req)` returns `true` for trusted machinery paths and
 *     for cron-secret-authenticated requests. `applyRateLimit` consults
 *     this helper first and short-circuits with `null` (admit) when it
 *     returns `true`.
 */
import "server-only";

import { Ratelimit } from "@upstash/ratelimit";
import { env } from "./env";
import { upstash, hasUpstash } from "./redis";

type Window = `${number} ${"s" | "m" | "h" | "d"}`;

interface LimiterDef {
    name: string;
    limit: number;
    window: Window;
}

/**
 * Cast a Zod-validated `<n> [smhd]` window string (which can contain
 * multiple whitespace characters per the regex) to the stricter
 * `Window` template-literal type used at runtime. The Ratelimit library
 * expects a single space; in practice every operator-set value uses one,
 * and the schema does not normalise. We do not coerce because tightening
 * the schema would break envs that explicitly set `"1  h"`.
 */
const asWindow = (w: string | undefined, fallback: Window): Window => (w ?? fallback) as Window;

const DEFS = {
    auth: { name: "auth", limit: 5, window: "1 m" },
    reservation: {
        name: "reservation",
        limit: env.RESERVATION_RL_LIMIT ?? 10,
        window: asWindow(env.RESERVATION_RL_WINDOW, "1 m"),
    },
    reservation_user: {
        name: "reservation_user",
        limit: env.RESERVATION_USER_RL_LIMIT ?? 20,
        window: asWindow(env.RESERVATION_USER_RL_WINDOW, "1 h"),
    },
    booking: { name: "booking", limit: 5, window: "1 m" },
    contact: {
        name: "contact",
        limit: env.CONTACT_RL_LIMIT ?? 3,
        window: asWindow(env.CONTACT_RL_WINDOW, "5 m"),
    },
    contact_user: {
        name: "contact_user",
        limit: env.CONTACT_USER_RL_LIMIT ?? 10,
        window: asWindow(env.CONTACT_USER_RL_WINDOW, "1 h"),
    },
    upload: { name: "upload", limit: 20, window: "1 h" },
} as const satisfies Record<string, LimiterDef>;

export type LimiterKind = keyof typeof DEFS;

/**
 * Mapping from the public-form per-IP `LimiterKind` to its per-user
 * counterpart. `applyRateLimit` (in `lib/api.ts`) reads this table to
 * decide whether to consult a second `"u:<userId>"` bucket when the
 * caller is authenticated.
 *
 * Kinds without a per-user counterpart are intentionally absent rather
 * than mapped to `undefined`, so a `kind in PER_USER_KIND` test reliably
 * distinguishes the two cohorts.
 */
export const PER_USER_KIND: Partial<Record<LimiterKind, LimiterKind>> = {
    contact: "contact_user",
    reservation: "reservation_user",
};

const cache = new Map<LimiterKind, Ratelimit>();

function getLimiter(kind: LimiterKind): Ratelimit | null {
    if (!upstash) return null;
    let l = cache.get(kind);
    if (!l) {
        const def = DEFS[kind];
        l = new Ratelimit({
            redis: upstash,
            limiter: Ratelimit.slidingWindow(def.limit, def.window),
            analytics: false,
            prefix: `pkzn:rl:${def.name}`,
        });
        cache.set(kind, l);
    }
    return l;
}

export interface RateLimitResult {
    success: boolean;
    limit: number;
    remaining: number;
    reset: number; // unix ms
}

const PASSTHROUGH: RateLimitResult = {
    success: true,
    limit: Number.POSITIVE_INFINITY,
    remaining: Number.POSITIVE_INFINITY,
    reset: 0,
};

/**
 * Check the limiter for a given identifier (IP, user id, or composite key).
 * In dev with no Upstash credentials this is a no-op.
 */
export async function check(kind: LimiterKind, identifier: string): Promise<RateLimitResult> {
    if (!hasUpstash()) return PASSTHROUGH;
    const limiter = getLimiter(kind);
    if (!limiter) return PASSTHROUGH;
    const r = await limiter.limit(identifier);
    return {
        success: r.success,
        limit: r.limit,
        remaining: r.remaining,
        reset: r.reset,
    };
}

/**
 * Extract a stable client IP from a Next.js Request headers object.
 * Order matches our hosting reality: Cloudflare → Vercel proxy → fallback.
 */
export function ipFromHeaders(headers: Headers): string {
    return (
        headers.get("cf-connecting-ip") ??
        headers.get("x-real-ip") ??
        headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        "unknown"
    );
}

/**
 * Constant-time string equality. Returns `false` immediately on length
 * mismatch (no information leak — an attacker who can probe lengths
 * already has the secret length budget). For equal-length inputs every
 * byte is compared, so the elapsed time depends only on `a.length`.
 *
 * NOTE: this comparison runs in-process, NOT on a remote service, so it
 * is the request-handling path that benefits from the constant-time
 * property. We use a plain XOR-fold rather than `crypto.timingSafeEqual`
 * to keep this module edge-runtime adjacent (the `server-only` import
 * above is the only Node-runtime guard) and to avoid a Buffer round-trip.
 */
function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let mismatch = 0;
    for (let i = 0; i < a.length; i++) {
        mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return mismatch === 0;
}

/**
 * `true` IFF the request is exempt from rate limiting:
 *   - URL pathname starts with `/api/cron/` (scheduled jobs), OR
 *   - URL pathname starts with `/api/internal/` (in-process callers,
 *     health probes), OR
 *   - the `X-Cron-Secret` header constant-time-equals `env.CRON_SECRET`
 *     (out-of-band cron triggers that hit a non-cron path).
 *
 * Pure helper — no Redis access, no I/O.
 */
export function isBypassPath(req: Request): boolean {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/cron/") || url.pathname.startsWith("/api/internal/")) {
        return true;
    }
    const header = req.headers.get("x-cron-secret");
    const secret = env.CRON_SECRET;
    if (header && secret && constantTimeEqual(header, secret)) {
        return true;
    }
    return false;
}
