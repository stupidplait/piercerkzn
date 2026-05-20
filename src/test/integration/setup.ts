/**
 * Vitest setup file for integration tests.
 *
 * Responsibilities:
 *   - Load env from `.env.local` (mirrors Next.js dev behaviour).
 *   - Mock `requireAdmin` and `applyRateLimit` from `@/lib/api` so tests
 *     don't need to manufacture admin sessions or wait on rate-limit
 *     state. The mocks are applied process-wide via `vi.mock`.
 *   - Verify the DB env is present before any test file runs; fail fast
 *     with a friendly message if not.
 *
 * The real `db` client and the rest of `@/lib/api` (`ok`, `fail`,
 * `parseJson`, etc.) are kept intact so we exercise the actual code paths.
 */
import { config } from "dotenv";
import path from "path";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
config({ path: path.resolve(__dirname, "../../../.env.local") });

if (!process.env.DATABASE_URL && !process.env.DATABASE_URL_POOLER) {
    throw new Error(
        "Integration tests require DATABASE_URL or DATABASE_URL_POOLER. " +
            "Set TEST_DATABASE_URL or copy .env.example to .env.local."
    );
}

// If TEST_DATABASE_URL is set, override the dev DB URL so we don't touch it.
if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.DATABASE_URL_POOLER = process.env.TEST_DATABASE_URL;
}

// ---------------------------------------------------------------------------
// Auth + rate-limit mocks
// ---------------------------------------------------------------------------
//
// Module mocks must be declared at the top level so Vitest can hoist them
// above any user imports.
//
// `@/lib/api` transitively imports `@/lib/auth` (which loads `next-auth`)
// and `@/lib/rate-limit` (which loads `@upstash/ratelimit`). Even when we
// override `requireAdmin` / `applyRateLimit` on the api module itself, the
// module-evaluation of the dependency chain still triggers those imports,
// and `next-auth`'s `next/server` resolution fails outside a Next.js
// runtime. We therefore stub the two upstream modules first; that lets the
// real `@/lib/api` load (so we keep production behaviour for `ok`, `fail`,
// `parseJson`, validation, etc.) and then selectively override the auth /
// rate-limit gates.

vi.mock("@/lib/auth", () => ({
    // `auth()` is the only export the real api module reaches for; return
    // null so any code path that survives the `requireAdmin` override
    // (none today) still gets a clean unauthenticated response.
    auth: vi.fn(async () => null),
    handlers: { GET: vi.fn(), POST: vi.fn() },
    signIn: vi.fn(),
    signOut: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
    check: vi.fn(async () => ({ success: true, remaining: 999, reset: 0 })),
    ipFromHeaders: vi.fn(() => "127.0.0.1"),
}));

vi.mock("@/lib/api", async () => {
    const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
    return {
        ...actual,
        requireAdmin: vi.fn(async () => ({
            ctx: {
                userId: "00000000-0000-0000-0000-0000000000aa",
                customerId: undefined,
                role: "admin" as const,
            },
            response: null,
        })),
        applyRateLimit: vi.fn(async () => null),
    };
});
