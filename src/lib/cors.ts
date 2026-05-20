/**
 * CORS gate for `/api/*` routes.
 *
 * Three pure functions form the contract used by route handlers and the
 * centralised preflight dispatcher in `src/middleware.ts`:
 *
 *   - {@link decideCors}  — classify a `Request` against the allowlist.
 *   - {@link applyCors}   — mutate response headers per the decision.
 *   - {@link handlePreflight} — produce the OPTIONS response for `/api/*`.
 *
 * Default-deny posture (Req 6.4, 6.9): when the `Origin` header is present
 * but missing from the allowlist, the gate omits `Access-Control-Allow-*`
 * entirely so the browser blocks the cross-origin read. Wildcard entries
 * are dropped at parse time with a `console.warn` (Req 6.8). The gate
 * NEVER emits `Access-Control-Allow-Origin: *` for credentialed routes
 * (Req 6.7); it always echoes the exact allowlisted origin.
 *
 * Edge-runtime safe by construction — only `Request`, `Response`,
 * `URL`, `Headers`, and pure JS primitives. Imported by `middleware.ts`
 * which runs at the edge.
 */
import { env } from "./env";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discriminated union returned by {@link decideCors}.
 *
 *   - `no_origin`: no `Origin` header — same-origin or non-CORS request.
 *   - `allowed`:   origin matches the allowlist; `credentialed` reflects
 *                  whether the request URL pathname is on the credentialed
 *                  routes list.
 *   - `denied`:    origin missing from the allowlist or unparseable.
 */
export type CorsDecision =
    | { kind: "no_origin" }
    | { kind: "allowed"; origin: string; credentialed: boolean }
    | {
          kind: "denied";
          origin: string;
          reason: "not_in_allowlist" | "malformed_origin";
      };

// ---------------------------------------------------------------------------
// Module-private constants
// ---------------------------------------------------------------------------

/**
 * Pathnames matching ANY of these regexes are credentialed and receive
 * `Access-Control-Allow-Credentials: true` on the allowed-CORS response.
 *
 *   - `/api/account(/|$)` — every authenticated account-scoped endpoint.
 *   - `/api/reservations` — reservation create + per-id sub-resources.
 *   - `/api/admin(/|$)`   — admin surface (auth gated upstream).
 *
 * Public routes (`/api/contact`, `/api/reviews/*`, `/api/blog/*`) are
 * deliberately absent: they don't need credentials, so the response
 * stays uncredentialed and the cross-origin browser cache for those
 * routes is shared across cookie state.
 */
const CREDENTIALED_PATTERNS: readonly RegExp[] = [
    /^\/api\/account(\/|$)/,
    /^\/api\/reservations/,
    /^\/api\/admin(\/|$)/,
];

const ALLOWED_METHODS = "GET, POST, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Content-Type, Authorization, X-Requested-With";
const PREFLIGHT_MAX_AGE = "600";
const NO_ORIGIN_ALLOW = "GET, POST, PATCH, DELETE";

// ---------------------------------------------------------------------------
// Allowlist — parser + memoised accessor
// ---------------------------------------------------------------------------

let memoizedAllowlist: readonly string[] | null = null;

/**
 * Parse a comma-separated `CORS_ALLOWED_ORIGINS` string into a frozen
 * list of canonical origin strings.
 *
 * Filtering rules (in order):
 *   1. Split on `,`, trim each entry, drop empties.
 *   2. Drop any entry containing `*` (Req 6.8). A `console.warn` is
 *      emitted of the form `[cors] discarded wildcard entry: <entry>`.
 *   3. Drop any entry where `new URL(entry)` throws.
 *   4. Drop any entry whose canonical `parsed.origin` differs from the
 *      raw entry — this rejects trailing slashes, query strings, paths,
 *      `file://`-style nullable origins, and similar non-canonical forms.
 *
 * The returned list is `Object.freeze`d so accidental mutation by tests
 * or downstream code throws.
 */
export function parseAllowlist(raw: string): readonly string[] {
    const out: string[] = [];
    for (const part of raw.split(",")) {
        const entry = part.trim();
        if (!entry) continue;
        if (entry.includes("*")) {
            console.warn(`[cors] discarded wildcard entry: ${entry}`);
            continue;
        }
        let parsed: URL;
        try {
            parsed = new URL(entry);
        } catch {
            continue;
        }
        if (parsed.origin !== entry) continue;
        out.push(entry);
    }
    return Object.freeze(out);
}

/**
 * Memoised accessor over `parseAllowlist(env.CORS_ALLOWED_ORIGINS ?? "")`.
 * Tests that need to swap the env value should `vi.mock("@/lib/env")` and
 * call {@link __resetCorsCache} to flush the memo.
 */
export function getAllowlist(): readonly string[] {
    if (memoizedAllowlist) return memoizedAllowlist;
    memoizedAllowlist = parseAllowlist(env.CORS_ALLOWED_ORIGINS ?? "");
    return memoizedAllowlist;
}

/**
 * Test seam — reset the {@link getAllowlist} memo. Only exported for use
 * by unit/property tests that want to re-parse `CORS_ALLOWED_ORIGINS`
 * after mocking `lib/env`.
 */
export function __resetCorsCache(): void {
    memoizedAllowlist = null;
}

// ---------------------------------------------------------------------------
// Decision logic
// ---------------------------------------------------------------------------

/**
 * TypeScript-level exhaustiveness helper. The compiler narrows
 * `CorsDecision` to `never` after every variant has been handled in a
 * `switch`. Adding a new variant without updating callers will fail the
 * build at the call site (Req 8.7).
 */
function assertNever(x: never): never {
    throw new Error(`[cors] unhandled CorsDecision variant: ${JSON.stringify(x)}`);
}

/**
 * Classify a request against the CORS allowlist. Pure / referentially
 * transparent: identical inputs produce structurally equal decisions.
 *
 * Decision tree:
 *   - No `Origin` header           → `{ kind: "no_origin" }`
 *   - Origin throws on `new URL`,
 *     or has empty protocol/host   → `denied (malformed_origin)`
 *   - Origin not in allowlist      → `denied (not_in_allowlist)`
 *   - Otherwise                    → `allowed` with `credentialed`
 *                                    set per {@link CREDENTIALED_PATTERNS}.
 */
export function decideCors(req: Request): CorsDecision {
    const origin = req.headers.get("origin");
    if (!origin) return { kind: "no_origin" };

    let parsed: URL;
    try {
        parsed = new URL(origin);
    } catch {
        return { kind: "denied", origin, reason: "malformed_origin" };
    }
    if (!parsed.protocol || !parsed.host) {
        return { kind: "denied", origin, reason: "malformed_origin" };
    }

    if (!getAllowlist().includes(origin)) {
        return { kind: "denied", origin, reason: "not_in_allowlist" };
    }

    const pathname = new URL(req.url).pathname;
    const credentialed = CREDENTIALED_PATTERNS.some((re) => re.test(pathname));
    return { kind: "allowed", origin, credentialed };
}

// ---------------------------------------------------------------------------
// Response-side application
// ---------------------------------------------------------------------------

/**
 * Mutate `res` in place with the CORS headers implied by `decision`.
 * Returns the same `Response` for chaining.
 *
 *   - `allowed`: sets `Access-Control-Allow-Origin: <origin>` (echoed
 *     exactly — never `*`, even for non-credentialed routes), appends
 *     `Vary: Origin`, and sets `Access-Control-Allow-Credentials: true`
 *     IFF the request hit a credentialed route.
 *   - `denied`/`no_origin`: no-op — the response leaves the gate without
 *     `Access-Control-Allow-*`, which is the default-deny contract.
 *
 * The `switch` is exhaustive over `CorsDecision`; the `default` calls
 * {@link assertNever} so adding a new variant breaks the build.
 */
export function applyCors(res: Response, decision: CorsDecision): Response {
    switch (decision.kind) {
        case "no_origin":
        case "denied":
            return res;
        case "allowed":
            // Echo the exact allowlisted origin — never `*`, even when
            // the route is non-credentialed (Req 6.7).
            res.headers.set("Access-Control-Allow-Origin", decision.origin);
            res.headers.append("Vary", "Origin");
            if (decision.credentialed) {
                res.headers.set("Access-Control-Allow-Credentials", "true");
            }
            return res;
        default:
            return assertNever(decision);
    }
}

// ---------------------------------------------------------------------------
// Preflight (OPTIONS) handler
// ---------------------------------------------------------------------------

/**
 * Build the response for a CORS preflight (`OPTIONS`) request.
 *
 *   - `allowed`:   `204` + `ACAO`/`Vary`/`ACAM`/`ACAH`/`Max-Age` (and
 *                  `ACAC` when credentialed).
 *   - `denied`:    `403` with no `Access-Control-*` headers.
 *   - `no_origin`: `405 + Allow: GET, POST, PATCH, DELETE` — a non-CORS
 *                  OPTIONS the API does not implement.
 *
 * The `switch` is exhaustive over `CorsDecision`; the `default` calls
 * {@link assertNever} so adding a new variant breaks the build.
 */
export function handlePreflight(req: Request): Response {
    const decision = decideCors(req);
    switch (decision.kind) {
        case "no_origin":
            return new Response(null, {
                status: 405,
                headers: { Allow: NO_ORIGIN_ALLOW },
            });
        case "denied":
            return new Response(null, { status: 403 });
        case "allowed": {
            const headers = new Headers({
                "Access-Control-Allow-Origin": decision.origin,
                Vary: "Origin",
                "Access-Control-Allow-Methods": ALLOWED_METHODS,
                "Access-Control-Allow-Headers": ALLOWED_HEADERS,
                "Access-Control-Max-Age": PREFLIGHT_MAX_AGE,
            });
            if (decision.credentialed) {
                headers.set("Access-Control-Allow-Credentials", "true");
            }
            return new Response(null, { status: 204, headers });
        }
        default:
            return assertNever(decision);
    }
}
