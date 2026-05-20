/**
 * Integration tests for `/api/customers/me` — the customer-self-service
 * profile endpoint. Imports the route handlers directly and calls them
 * with synthetic `Request` objects (no HTTP server), per the established
 * convention in the rest of `src/app/api/**\/*.integration.test.ts`.
 *
 * Scope (Phase 3, task 3.5):
 *   1. GET happy path        — seeded customer + forged session, expect
 *                              200 with `customer.id` / `customer.email`
 *                              echoing the seeded row (Req 3.1).
 *   2. GET unauthenticated   — leave the default `auth() → null` mock
 *                              from `setup.ts` in place, expect 401 +
 *                              `error.code: "unauthorized"` (Req 3.3).
 *   3. PATCH happy path      — forged session + valid `{ firstName }`,
 *                              expect 200 with the updated value
 *                              reflected in the response and persisted
 *                              in the DB (Req 3.1, 3.2).
 *   4. PATCH invalid body    — forged session + a malformed `phone`
 *                              field, expect 422 + `validation_error`
 *                              (Req 3.4, 3.5).
 *   5. DELETE guard fires    — forged session + a customer that has a
 *                              password hash, DELETE with no body, expect
 *                              400 + `error.code: "password_required"`.
 *                              The pre-condition (presence of
 *                              `passwordHash`) is the guard the route
 *                              checks BEFORE the soft-delete (Req 3.8).
 *
 * ---------------------------------------------------------------------------
 * Mock surface
 * ---------------------------------------------------------------------------
 *
 *   `setup.ts` already mocks `@/lib/auth` (`auth: vi.fn(async () => null)`),
 *   `@/lib/rate-limit`, and `@/lib/api` process-wide
 *   (see `src/test/integration/README.md` §5). The customer-scoped tests
 *   below override the `auth` mock for one call at a time via
 *   `authMock.mockResolvedValueOnce(...)`. The `requireUser()`
 *   guard in `@/lib/api` calls `getOptionalUser()` which reads
 *   `session.user.id` / `session.user.customerId` / `session.user.role`,
 *   so the forged session shape matches the production JWT-callback
 *   output documented in `src/lib/auth.ts`.
 *
 *   This file additionally hoists a single route-specific mock:
 *
 *   - `@/lib/posthog` — stubs `capture()` so the PATCH success path
 *     (the route fires `capture({ event: "customer_profile_updated" })`
 *     after the UPDATE) does not require `POSTHOG_API_KEY` to be set.
 *     `posthog.ts` already short-circuits when the key is missing, but
 *     stubbing here keeps the test deterministic regardless of local env.
 */
import { count, eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DELETE, GET, PATCH } from "./route";
import { auth } from "@/lib/auth";
import { customers, db } from "@/db";
import {
    buildRequest,
    createCustomerForReservation,
    expectRowCountUnchanged,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

// `auth` from `next-auth` v5 is an overloaded function (route-handler
// wrapper, middleware, AND session getter). The integration `setup.ts`
// stub exposes it as the session-getter form (`async () => Session | null`),
// so for `vi.mocked(...)` ergonomics we narrow the export to that single
// signature here. This affects only the mock-control surface in this
// file — the production import path is unchanged.
const authMock = vi.mocked(
    auth as unknown as () => Promise<{
        user: { id: string; customerId?: string; role?: "customer" | "admin" | "staff" };
    } | null>
);

// ---------------------------------------------------------------------------
// Module mocks (route-specific)
// ---------------------------------------------------------------------------
//
// `vi.mock` calls are hoisted by Vitest to the top of the module, before
// any of the imports above are resolved. That is how the real `./route`
// import below sees the stubbed `@/lib/posthog` rather than the
// production module.

vi.mock("@/lib/posthog", () => ({
    // The route fires `capture({ event: "customer_profile_updated" })`
    // on the PATCH success path and `capture({ event: "customer_deleted" })`
    // on the DELETE success path (not exercised here — the guard test
    // short-circuits before deletion). Stubbing the export keeps the
    // suite deterministic regardless of whether `POSTHOG_API_KEY` is
    // present in `.env.local`.
    capture: vi.fn(),
    flush: vi.fn(async () => undefined),
    posthog: null,
    getPostHogSessionId: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Test fixtures and constants
// ---------------------------------------------------------------------------

/** Tag shared by every test in this file — single cleanup at `afterAll`. */
const tag = makeTestTag("p3-customers-me");

/**
 * Forge a customer session for the route's `requireUser()` guard. Mirrors
 * the JWT-callback output shape documented in `src/lib/auth.ts`
 * (`{ user: { id, customerId, role } }`). The `getOptionalUser()` helper
 * in `@/lib/api` reads exactly those three fields off `session.user`.
 */
function customerSession(customerId: string) {
    return {
        user: {
            id: customerId,
            customerId,
            role: "customer" as const,
        },
    };
}

interface ProfileResponseBody {
    customer: {
        id: string;
        email: string;
        firstName: string;
        lastName: string | null;
        phone: string | null;
        notificationEmail: boolean | null;
        notificationMarketing: boolean | null;
    };
}

interface ErrorBody {
    error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Row-count snapshot bookkeeping (Req 3.8)
// ---------------------------------------------------------------------------
//
// Mirrors the pattern from `src/app/api/contact/route.integration.test.ts`,
// with one important difference: the `customer` table is shared with the
// dev environment (OAuth sign-ins, magic-link probes, etc. write to it
// out-of-band when local dev runs against the same DB). A bare
// `count() FROM customer` snapshot would diverge under concurrent dev
// activity even when this suite's cleanup is perfect.
//
// Instead, the snapshot below counts ONLY rows whose `email` matches the
// suite-wide tag. Before any test runs, that count is `0`; after
// `afterAll` deletes the seeded row, it must be `0` again. Net-zero on
// the rows this suite owns is the invariant Req 3.8 actually asks for —
// external mutations on other rows are not part of "this test's
// mutations". `expectRowCountUnchanged` still does the diff for us.

type RowCounts = Record<string, number>;

async function snapshotTaggedCustomerRows(): Promise<RowCounts> {
    const [{ n }] = await db
        .select({ n: count() })
        .from(customers)
        .where(like(customers.email, `%${tag}%`));
    return { tagged_customer: n };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("/api/customers/me integration", () => {
    let snapshotBefore: RowCounts;
    let seeded: { id: string; email: string };

    beforeAll(async () => {
        snapshotBefore = await snapshotTaggedCustomerRows();
        // `createCustomerForReservation` writes a tagged customer with a
        // deterministic Argon2 password hash (`${tag}-pw`). The hash
        // matters for the DELETE guard test: the guard only fires for
        // credential accounts (those with a non-null `passwordHash`).
        seeded = await createCustomerForReservation(tag);
    });

    afterAll(async () => {
        // Custom cleanup: this route only touches the `customer` table,
        // and the seeded row carries `${tag}` in its `email`. A single
        // tagged DELETE removes it; idempotent so it is safe even if a
        // test threw mid-way.
        await db.delete(customers).where(eq(customers.email, seeded.email));
        const snapshotAfter = await snapshotTaggedCustomerRows();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    afterEach(() => {
        // Belt-and-braces: clear any per-test `mockResolvedValueOnce`
        // override that did not get consumed (e.g. test threw before
        // the route handler called `auth()`). The default `auth() → null`
        // mock from `setup.ts` is restored implicitly because
        // `mockResolvedValueOnce` is a one-shot queue entry.
        authMock.mockReset();
        // Restore the default `setup.ts` behaviour — `auth() → null`.
        // Without this, subsequent tests that DON'T forge a session
        // (e.g. the unauthenticated path) would see `undefined` instead
        // of `null` from the mock.
        authMock.mockResolvedValue(null);
    });

    // -------------------------------------------------------------------
    // GET happy path (Req 3.1, 3.2)
    // -------------------------------------------------------------------
    //
    // Forges a customer session for the seeded row, calls GET, and
    // expects the route to round-trip the seeded `id` / `email` /
    // `firstName` back to the caller. The `deletedAt` column is
    // intentionally stripped by the route's `publicProfile()` helper —
    // we only assert the public columns.
    it("GET — returns the authenticated customer's profile (Req 3.1, 3.2)", async () => {
        authMock.mockResolvedValueOnce(customerSession(seeded.id));

        const res = await GET();
        const { status, json } = await readResponse<ProfileResponseBody>(res);

        expect(status).toBe(200);
        expect(json.customer.id).toBe(seeded.id);
        expect(json.customer.email).toBe(seeded.email);
        // `createCustomerForReservation` writes `firstName: tag`.
        expect(json.customer.firstName).toBe(tag);
        // The route MUST NOT leak `deletedAt` — verify it is absent.
        expect(json.customer).not.toHaveProperty("deletedAt");
    });

    // -------------------------------------------------------------------
    // GET unauthenticated → 401 (Req 3.3)
    // -------------------------------------------------------------------
    //
    // Default `auth() → null` mock from `setup.ts` (restored in
    // `afterEach`). `requireUser()` short-circuits with `unauthorized()`
    // → HTTP 401 + `error.code: "unauthorized"`.
    it("GET — returns 401 when there is no session (Req 3.3)", async () => {
        const res = await GET();
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(401);
        expect(json.error.code).toBe("unauthorized");
    });

    // -------------------------------------------------------------------
    // PATCH happy path (Req 3.1, 3.2)
    // -------------------------------------------------------------------
    //
    // Forges a session, sends a minimal `{ firstName }` patch, expects
    // the route to UPDATE the row and echo the new value back. We then
    // re-read the row directly via Drizzle to confirm persistence —
    // round-tripping through GET would be redundant with test #1.
    //
    // The new value is namespaced with `${tag}` so the suite-wide
    // tagged cleanup still removes the row in `afterAll`.
    it("PATCH — applies a partial update on the happy path (Req 3.1, 3.2)", async () => {
        authMock.mockResolvedValueOnce(customerSession(seeded.id));

        const newFirstName = `${tag}-renamed`;
        const res = await PATCH(
            buildRequest("/api/customers/me", "PATCH", {
                body: { firstName: newFirstName },
            })
        );
        const { status, json } = await readResponse<ProfileResponseBody>(res);

        expect(status).toBe(200);
        expect(json.customer.firstName).toBe(newFirstName);

        // Persistence check — re-read the row and confirm the column
        // was actually written, not just echoed from the in-memory
        // patch. This catches a regression where the route returns the
        // input shape without performing the UPDATE.
        const [row] = await db
            .select({ firstName: customers.firstName })
            .from(customers)
            .where(eq(customers.id, seeded.id))
            .limit(1);
        expect(row?.firstName).toBe(newFirstName);
    });

    // -------------------------------------------------------------------
    // PATCH invalid body → 422 + validation_error (Req 3.4, 3.5)
    // -------------------------------------------------------------------
    //
    // `phoneSchema` (in `lib/validations/common.ts`) accepts only
    // `+7XXXXXXXXXX` or `8XXXXXXXXXX`. A free-text value is rejected at
    // the schema layer with `error.code: "validation_error"` / HTTP 422
    // (the lowercase `ErrorCode.Validation` constant from `@/lib/api`).
    //
    // The `details` array MUST surface a `phone` path so callers can
    // render a field-level error in the UI.
    it("PATCH — returns 422 + validation_error for a malformed phone (Req 3.4, 3.5)", async () => {
        authMock.mockResolvedValueOnce(customerSession(seeded.id));

        const res = await PATCH(
            buildRequest("/api/customers/me", "PATCH", {
                body: { phone: "not-a-phone" },
            })
        );
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(422);
        expect(json.error.code).toBe("validation_error");
        const details = json.error.details as Array<{ path: string }> | undefined;
        expect(details?.some((d) => d.path === "phone")).toBe(true);
    });

    // -------------------------------------------------------------------
    // DELETE guard fires when password confirmation is missing (Req 3.8)
    // -------------------------------------------------------------------
    //
    // The seeded customer has a non-null `passwordHash` (Argon2 of
    // `${tag}-pw`, written by `createCustomerForReservation`). The
    // route's DELETE handler walks the body parsing branch only when
    // the request carries a JSON content-type + content-length — sending
    // a request without a body therefore lands in the `if (!input.password)`
    // branch with `input = {}`, returning HTTP 400 + the
    // `password_required` error code defined inline in the route.
    //
    // This is the smallest reproduction of the guard: no soft-delete
    // happens, the seeded customer is left intact for the suite-wide
    // cleanup, and the row-count snapshot in `afterAll` continues to
    // hold.
    it("DELETE — returns 400 + password_required when confirmation is missing (Req 3.8)", async () => {
        authMock.mockResolvedValueOnce(customerSession(seeded.id));

        // `buildRequest` only sets `content-type` + `content-length`
        // when `body` is provided; omitting it lands the route in the
        // "OAuth-only branch" of the body parser and then in the
        // `if (row.passwordHash) { if (!input.password) … }` guard.
        const res = await DELETE(buildRequest("/api/customers/me", "DELETE"));
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(400);
        expect(json.error.code).toBe("password_required");

        // The guard MUST short-circuit before the soft-delete UPDATE,
        // so `deletedAt` should still be NULL on the seeded row.
        const [row] = await db
            .select({ deletedAt: customers.deletedAt })
            .from(customers)
            .where(eq(customers.id, seeded.id))
            .limit(1);
        expect(row?.deletedAt).toBeNull();
    });
});
