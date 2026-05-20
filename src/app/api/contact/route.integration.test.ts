/**
 * Integration tests for `POST /api/contact` — the public contact-form
 * endpoint. Imports the route handler directly and calls it with synthetic
 * `Request` objects (no HTTP server), per the established admin-test
 * convention under `src/app/api/admin/**\/*.integration.test.ts` and the
 * Phase 2 reservation-route example at
 * `src/app/api/reservations/route.integration.test.ts`.
 *
 * Scope (Phase 3, task 3.9):
 *   1. Happy path           — POST a valid inquiry, expect 201 with
 *                             `inquiry.referenceNumber` matching
 *                             `^PK-INQ-\d{4}-\d{4}$` and
 *                             `inquiry.status === "new"` (Req 3.1).
 *   2. Missing email        — POST without email, expect 422 +
 *                             `error.code: "validation_error"`
 *                             (Req 3.4 / 3.5).
 *   3. Invalid email format — POST malformed email, expect 422 +
 *                             `error.code: "validation_error"`
 *                             (Req 3.5).
 *   4. Rate-limit 429       — override `applyRateLimit` for one call to
 *                             return a 429 envelope, observe the route
 *                             returns 429 + `error.code: "rate_limited"`
 *                             (Req 3.10 / AC 3.10).
 *   5. Cleanup              — `cleanupTaggedRows(tag)` deletes inquiries
 *                             matching `email LIKE %tag%` (helpers.ts
 *                             extension landed alongside this file).
 *
 * ---------------------------------------------------------------------------
 * Mock surface
 * ---------------------------------------------------------------------------
 *
 *   `setup.ts` already mocks `@/lib/auth`, `@/lib/rate-limit`, and
 *   `@/lib/api` process-wide (see `src/test/integration/README.md` §5).
 *   Those mocks are inherited unchanged.
 *
 *   This file additionally hoists two route-specific mocks:
 *
 *   - `@/lib/captcha/route-helpers` — overrides `isVerifyOk` to admit every
 *      request. The local `.env.local` carries `CAPTCHA_PROVIDER=disabled`
 *      and `CAPTCHA_DEV_BYPASS=0`, so without this override the route would
 *      422 every request via `captchaRejection()` before reaching the
 *      domain layer. Mirrors the captcha mock pattern from
 *      `src/app/api/reservations/route.integration.test.ts`.
 *   - `@/lib/posthog` — stubs `capture()` so the success-path PostHog
 *      analytics call (the route fires `capture({ event: "contact_submitted" })`
 *      after persistence) does not require `POSTHOG_API_KEY` to be set.
 *      `posthog.ts` already short-circuits when the key is missing, but
 *      stubbing here keeps the test deterministic regardless of local env.
 *
 *   The rate-limit mock is the one declared in `setup.ts`
 *   (`@/lib/api.applyRateLimit` → `vi.fn(async () => null)`); the 429
 *   test below flips it for a single call via `vi.mocked(...).mockResolvedValueOnce(...)`
 *   and resets it in `beforeEach`.
 */
import { count } from "drizzle-orm";
import { NextResponse } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { applyRateLimit } from "@/lib/api";
import { db, inquiries } from "@/db";
import {
    buildRequest,
    cleanupTaggedRows,
    expectRowCountUnchanged,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

// ---------------------------------------------------------------------------
// Module mocks (route-specific)
// ---------------------------------------------------------------------------
//
// `vi.mock` calls are hoisted by Vitest to the top of the module, before
// any of the imports above are resolved. That is how the real `./route`
// import below sees the stubbed dependencies rather than the production
// modules.

vi.mock("@/lib/captcha/route-helpers", async () => {
    const actual = await vi.importActual<typeof import("@/lib/captcha/route-helpers")>(
        "@/lib/captcha/route-helpers"
    );
    return {
        ...actual,
        // Admit every request through the captcha gate. The verifier
        // itself (`@/lib/captcha/verify`) still runs and returns
        // `{ ok: false, reason: "verifier_disabled" }` (because
        // `CAPTCHA_PROVIDER=disabled` in `.env.local`), but `isVerifyOk`
        // collapses that to a pass for the duration of this suite.
        isVerifyOk: vi.fn(() => true),
    };
});

vi.mock("@/lib/posthog", () => ({
    // The route fires `capture({ event: "contact_submitted", … })` on
    // the success path. Stubbing the export keeps the test deterministic
    // regardless of whether `POSTHOG_API_KEY` is present in `.env.local`.
    capture: vi.fn(),
    flush: vi.fn(async () => undefined),
    posthog: null,
    getPostHogSessionId: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Test fixtures and constants
// ---------------------------------------------------------------------------

/**
 * Captcha token of length 40 — passes the route's Zod schema
 * (`captchaToken: z.string().min(20).max(2000)`) without producing a
 * meaningful provider call. The captcha-helpers mock above admits the
 * request regardless of token contents.
 */
const STUB_CAPTCHA_TOKEN = "x".repeat(40);

/** Tag shared by every test in this file — single cleanup at `afterAll`. */
const tag = makeTestTag("p3-contact");

/**
 * Build a valid contact-form payload reusable across the happy path +
 * negative branches. Tests mutate one field at a time so the only
 * difference between cases is the breaking change.
 */
function basePayload(overrides: Record<string, unknown> = {}) {
    return {
        name: `${tag}-name`,
        email: `${tag}@test.local`,
        phone: "+70000000000",
        subject: "general",
        message: `Тестовое сообщение для тегa ${tag}`,
        captchaToken: STUB_CAPTCHA_TOKEN,
        ...overrides,
    };
}

interface InquiryResponseBody {
    inquiry: {
        id: string;
        referenceNumber: string;
        status: string;
        createdAt: string;
    };
    message: string;
}

interface ErrorBody {
    error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Row-count snapshot bookkeeping (Req 3.8)
// ---------------------------------------------------------------------------
//
// Mirrors the pattern from `src/app/api/reservations/route.integration.test.ts`.
// The contact route only inserts into `inquiry`, so a single-table
// snapshot is sufficient.

type RowCounts = Record<string, number>;

async function snapshotRowCounts(): Promise<RowCounts> {
    const [[inquiryCount]] = await Promise.all([db.select({ n: count() }).from(inquiries)]);
    return {
        inquiry: inquiryCount.n,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POST /api/contact integration", () => {
    let snapshotBefore: RowCounts;

    beforeAll(async () => {
        snapshotBefore = await snapshotRowCounts();
    });

    afterAll(async () => {
        // Idempotent — safe even if a test threw mid-way and never
        // inserted. `cleanupTaggedRows` deletes inquiries by
        // `email LIKE %tag%` (helpers.ts extension landed alongside this
        // file).
        await cleanupTaggedRows(tag);
        const snapshotAfter = await snapshotRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    beforeEach(() => {
        // Default rate-limit mock from setup.ts admits every request.
        // Tests that need a 429 flip it via `mockResolvedValueOnce` and
        // we reset it here so leakage cannot occur across test ordering.
        vi.mocked(applyRateLimit).mockResolvedValue(null);
    });

    afterEach(() => {
        // Belt-and-braces: clear the per-test override so the next test
        // sees the clean default-resolved-null mock state, even when a
        // test failed before `mockResolvedValueOnce` was consumed.
        vi.mocked(applyRateLimit).mockReset();
    });

    // -------------------------------------------------------------------
    // Happy path (Req 3.1, 3.2)
    // -------------------------------------------------------------------
    //
    // POSTs a valid inquiry, asserts 201 + a wire-shaped reference
    // number (`PK-INQ-YYYY-NNNN`) and `status: "new"`.
    //
    // The contact route uses `allocateAndInsert("INQ", …)` (post-bugfix
    // for the reference-number-collision-race spec), which formats via
    // `formatReferenceNumber("INQ", year, suffix)` — matching the
    // `/^PK-INQ-\d{4}-\d{4}$/` shape.
    it("creates an inquiry on the happy path (Req 3.1, 3.2)", async () => {
        const res = await POST(buildRequest("/api/contact", "POST", { body: basePayload() }));
        const { status, json } = await readResponse<InquiryResponseBody>(res);

        expect(status).toBe(201);
        expect(json.inquiry.status).toBe("new");
        expect(json.inquiry.referenceNumber).toMatch(/^PK-INQ-\d{4}-\d{4}$/);
        expect(json.inquiry.id).toBeTruthy();
        expect(json.message).toMatch(/Сообщение получено/);
    });

    // -------------------------------------------------------------------
    // Missing email → 422 + validation_error (Req 3.4, 3.5)
    // -------------------------------------------------------------------
    //
    // The Zod schema requires `email` (`emailSchema` is non-optional in
    // `contactInquirySchema`). `parseJson` runs before captcha
    // verification (see route step ordering in
    // `src/app/api/contact/route.ts`), so an absent `email` short-
    // circuits at the schema layer and is mapped via `validationFailed()`
    // to HTTP 422 + `error.code: "validation_error"` (the lowercase
    // `ErrorCode.Validation` constant from `@/lib/api`).
    it("returns 422 + validation_error when email is missing (Req 3.4, 3.5)", async () => {
        const { email: _omit, ...rest } = basePayload();
        void _omit;

        const res = await POST(buildRequest("/api/contact", "POST", { body: rest }));
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(422);
        expect(json.error.code).toBe("validation_error");
        // The Zod issue list should mention the `email` path so callers
        // can surface a field-level error in the UI. Cast through
        // `unknown` to access the structural shape without exposing
        // implementation details to TypeScript.
        const details = json.error.details as Array<{ path: string }> | undefined;
        expect(details?.some((d) => d.path === "email")).toBe(true);
    });

    // -------------------------------------------------------------------
    // Invalid email format → 422 (Req 3.5)
    // -------------------------------------------------------------------
    //
    // `emailSchema` (in `lib/validations/common.ts`) applies
    // `.email("Введите корректный email")`, so a malformed value is
    // rejected at the schema layer with `error.code: "validation_error"`
    // / HTTP 422.
    it("returns 422 + validation_error for a malformed email (Req 3.5)", async () => {
        const res = await POST(
            buildRequest("/api/contact", "POST", {
                body: basePayload({ email: "not-an-email" }),
            })
        );
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(422);
        expect(json.error.code).toBe("validation_error");
    });

    // -------------------------------------------------------------------
    // Rate-limit 429 (Req 3.10 / AC 3.10)
    // -------------------------------------------------------------------
    //
    // The route's first step (after CORS classification) is
    // `await applyRateLimit(req, "contact")`. `setup.ts` mocks the
    // helper to a no-op (`async () => null`), and we override it for a
    // single call here to return a 429 `NextResponse` — exercising the
    // route's `if (limited) return applyCors(limited, …)` branch.
    //
    // The 429 envelope shape is the same one `rateLimited()` from
    // `@/lib/api` produces: status 429, body
    // `{ error: { code: "rate_limited", message: <RU string> } }`,
    // with a `Retry-After` header. We assemble it inline here rather
    // than importing `rateLimited` so the test does not depend on the
    // implementation detail of which helper the production route uses
    // — the wire shape is the contract.
    it("returns 429 when applyRateLimit denies the request (Req 3.10 / AC 3.10)", async () => {
        const limitedResponse = NextResponse.json(
            {
                error: {
                    code: "rate_limited",
                    message: "Слишком много запросов, попробуйте позже",
                },
            },
            { status: 429, headers: { "Retry-After": "60" } }
        );

        // Snapshot the inquiry row count immediately before the call so
        // the post-condition below is robust to test ordering — a
        // future re-ordering or insertion of additional happy-path
        // tests above this one cannot break the assertion.
        const [{ n: nBefore }] = await db.select({ n: count() }).from(inquiries);

        // Flip the mock for exactly one call. The `beforeEach` reset
        // restores the admit-everything default for the next test.
        vi.mocked(applyRateLimit).mockResolvedValueOnce(limitedResponse);

        const res = await POST(buildRequest("/api/contact", "POST", { body: basePayload() }));
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(429);
        expect(json.error.code).toBe("rate_limited");

        // The route MUST short-circuit before persistence, so no new
        // `inquiry` row should have been written. Verifying the count
        // is unchanged doubles as an early failure-mode signal in case
        // the rate-limit short-circuit regressed.
        const [{ n: nAfter }] = await db.select({ n: count() }).from(inquiries);
        expect(nAfter).toBe(nBefore);
    });
});
