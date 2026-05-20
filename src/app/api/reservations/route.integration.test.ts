/**
 * Integration tests for `POST /api/reservations` — the public reservation
 * creation endpoint. Imports the route handler directly and calls it with
 * synthetic `Request` objects (no HTTP server), per the established admin-
 * test convention under `src/app/api/admin/**\/*.integration.test.ts`.
 *
 * Scope (Phase 2, task 2.1 — example tests only):
 *   1. Happy path             — seed fixtures, POST 1 unit, expect 201 +
 *                                `status: "pending"` + `PK-RES-YYYY-NNNN`
 *                                reference number (Req 2.1).
 *   2. Variant not found      — POST a fabricated UUID, observe the route's
 *                                `ReservationError("variant_not_found")`
 *                                mapping (Req 2.1).
 *   3. Empty items            — POST `items: []`, observe Zod's mapping via
 *                                `validationFailed()` (Req 2.1).
 *   4. Row-count snapshot     — captured in `beforeAll`, asserted unchanged
 *                                in `afterAll` after `cleanupReservationRows`
 *                                runs (AC 2.12).
 *
 * The Property 3 PBT (concurrent admission honors stock under contention,
 * Req 2.2) lands in this same file in task 2.3 — placeholder marked at the
 * bottom of the suite.
 *
 * ---------------------------------------------------------------------------
 * Mock surface
 * ---------------------------------------------------------------------------
 *
 *   `setup.ts` already mocks `@/lib/auth`, `@/lib/rate-limit`, and
 *   `@/lib/api` process-wide (see `src/test/integration/README.md` §5).
 *   Those mocks are inherited unchanged.
 *
 *   This file additionally hoists four route-specific mocks:
 *
 *   - `@/lib/captcha/route-helpers` — overrides `isVerifyOk` to admit every
 *      request. The local `.env.local` carries `CAPTCHA_PROVIDER=disabled`
 *      and `CAPTCHA_DEV_BYPASS=0`, so without this override the route would
 *      422 every request via `captchaRejection()` before reaching the
 *      domain layer.
 *   - `@/lib/queue` — stubs `enqueueReservationExpiry` so the route's
 *      best-effort BullMQ enqueue does not require a live Redis (matches
 *      AC 2.7 for the upcoming Property 3 PBT in task 2.3).
 *   - `@/lib/telegram/notifications` — stubs `notifyReservationCreated` to
 *      keep the route's fire-and-forget Telegram push from touching the
 *      grammY bot (which would throw without `TELEGRAM_BOT_TOKEN`).
 *   - `@/emails/dispatch` — stubs `sendReservationConfirmationEmail` so the
 *      route's fire-and-forget Resend send does not insert a
 *      `notification_log` row (no `ON DELETE CASCADE` on
 *      `notification_log.customer_id`, which would block the customer
 *      cleanup at the end of the run).
 *
 *   Mocks for module side effects are intentionally narrow (single export
 *   each) so a future refactor that adds a new export still runs the real
 *   implementation and surfaces in test output rather than silently passing.
 */
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { customers, db, productVariants, products, reservationItems, reservations } from "@/db";
import {
    buildRequest,
    expectRowCountUnchanged,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";
import {
    cleanupReservationRows,
    resetUpstashStub,
    seedReservationFixtures,
} from "@/test/integration/reservation-fixtures";
import { fc, fcAssert } from "@/test/property/fc-config";

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
        // Admit every request through the captcha gate. The verifier itself
        // (`@/lib/captcha/verify`) still runs and returns
        // `{ ok: false, reason: "verifier_disabled" }` (because
        // `CAPTCHA_PROVIDER=disabled` in `.env.local`), but `isVerifyOk`
        // collapses that to a pass for the duration of this suite.
        isVerifyOk: vi.fn(() => true),
    };
});

vi.mock("@/lib/queue", () => ({
    // Resolved promise — the route fires this with `void …catch(...)`, so a
    // resolved value is sufficient. Returning `undefined` keeps the mock
    // surface minimal.
    enqueueReservationExpiry: vi.fn(async () => undefined),
}));

vi.mock("@/lib/telegram/notifications", () => ({
    notifyReservationCreated: vi.fn(async () => undefined),
}));

vi.mock("@/emails/dispatch", () => ({
    sendReservationConfirmationEmail: vi.fn(async () => null),
}));

// ---------------------------------------------------------------------------
// Test fixtures and constants
// ---------------------------------------------------------------------------

/**
 * Captcha token of length 20 — passes the route's Zod schema
 * (`captchaToken: z.string().min(20).max(2000)`) without producing a
 * meaningful provider call. The captcha-helpers mock above admits the
 * request regardless of token contents.
 */
const STUB_CAPTCHA_TOKEN = "x".repeat(40);

/** Tag shared by every test in this file — single cleanup at `afterAll`. */
const tag = makeTestTag("p2-res-route");

/**
 * Customer payload shape required by `createReservationSchema`. Reused
 * across the happy path + 404 + empty-items branches so the only difference
 * between cases is the `items` array.
 */
const baseCustomer = {
    firstName: "Тест",
    lastName: tag,
    email: `${tag}@test.local`,
    phone: "+70000000000",
};

interface ReservationResponseBody {
    reservation: {
        id: string;
        referenceNumber: string;
        status: string;
        total: number;
        currencyCode: string;
        expiresAt: string;
        customerNotes: string | null;
        createdAt: string;
        items: Array<{
            id: string;
            sku: string;
            quantity: number;
            unitPrice: number;
            total: number;
        }>;
    };
}

interface ErrorBody {
    error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Row-count snapshot bookkeeping (AC 2.12)
// ---------------------------------------------------------------------------
//
// Mirrors the helper in `src/lib/reservations.integration.test.ts` so the
// two reservation files use a single, copy-pasteable pattern. The five
// tables below are the entire surface this file's seeding + the SUT touch:
//
//   - product / product_variant / customer   — fixture inserts
//   - reservation / reservation_item         — SUT inserts
//
// `cleanupReservationRows(tag)` deletes children before parents (see the
// `reservation-fixtures.ts` header), so a clean run lands the counts back
// at their pre-test values.

type RowCounts = Record<string, number>;

async function snapshotRowCounts(): Promise<RowCounts> {
    const [
        [productCount],
        [variantCount],
        [customerCount],
        [reservationCount],
        [reservationItemCount],
    ] = await Promise.all([
        db.select({ n: count() }).from(products),
        db.select({ n: count() }).from(productVariants),
        db.select({ n: count() }).from(customers),
        db.select({ n: count() }).from(reservations),
        db.select({ n: count() }).from(reservationItems),
    ]);
    return {
        product: productCount.n,
        product_variant: variantCount.n,
        customer: customerCount.n,
        reservation: reservationCount.n,
        reservation_item: reservationItemCount.n,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POST /api/reservations integration", () => {
    let snapshotBefore: RowCounts;

    beforeAll(async () => {
        snapshotBefore = await snapshotRowCounts();
    });

    afterAll(async () => {
        // Idempotent — safe even if a test threw mid-way and never seeded.
        await cleanupReservationRows(tag);
        const snapshotAfter = await snapshotRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    beforeEach(() => {
        // Reset the in-memory Upstash stub between tests so a future PBT
        // (Property 3 — added in task 2.3) cannot leak rate-limit state
        // across iterations. The current example tests do not exercise
        // the limiter — `applyRateLimit` is mocked process-wide in
        // `setup.ts` — but resetting here keeps the seam in place.
        resetUpstashStub();
    });

    // -------------------------------------------------------------------
    // Happy path (Req 2.1)
    // -------------------------------------------------------------------
    //
    // Seeds one variant with `inventoryQty: 5`, posts a single-unit
    // reservation, and asserts 201 + `status: "pending"` + a wire-shaped
    // reference number (`PK-RES-YYYY-NNNN`) per design §"Phase 2" and
    // `lib/reference-numbers.ts`.
    it("creates a pending reservation on the happy path (Req 2.1)", async () => {
        const fixtures = await seedReservationFixtures(tag, { inventoryQty: 5 });

        const res = await POST(
            buildRequest("/api/reservations", "POST", {
                body: {
                    items: [{ variantId: fixtures.variantIds[0], quantity: 1 }],
                    customer: baseCustomer,
                    captchaToken: STUB_CAPTCHA_TOKEN,
                },
            })
        );
        const { status, json } = await readResponse<ReservationResponseBody>(res);

        expect(status).toBe(201);
        expect(json.reservation.status).toBe("pending");
        // `nextReferenceNumber("RES", …)` formats as `PK-RES-{YEAR}-{NNNN}`.
        expect(json.reservation.referenceNumber).toMatch(/^PK-RES-\d{4}-\d{4}$/);
        expect(json.reservation.items).toHaveLength(1);
        expect(json.reservation.items[0].quantity).toBe(1);
    });

    // -------------------------------------------------------------------
    // Variant not found (Req 2.1)
    // -------------------------------------------------------------------
    //
    // The reservation route maps `ReservationError.code === "variant_not_found"`
    // to HTTP 400 with `error.code: "variant_not_found"` (lowercase, via
    // the `fail(error.code, …)` call in the route handler — see
    // `app/src/app/api/reservations/route.ts`). The design table at
    // §"`ReservationError` mapping" documents the intended wire shape; the
    // current implementation emits the code verbatim from the SUT, so we
    // assert against the actual lowercase wire value.
    it("returns 400 + variant_not_found for an unknown variantId (Req 2.1)", async () => {
        // Real UUID format so the request passes `uuidSchema` and reaches
        // the domain layer where the SUT throws `variant_not_found`.
        const fabricatedVariantId = crypto.randomUUID();

        const res = await POST(
            buildRequest("/api/reservations", "POST", {
                body: {
                    items: [{ variantId: fabricatedVariantId, quantity: 1 }],
                    customer: baseCustomer,
                    captchaToken: STUB_CAPTCHA_TOKEN,
                },
            })
        );
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(400);
        expect(json.error.code).toBe("variant_not_found");
    });

    // -------------------------------------------------------------------
    // Empty items (Req 2.1)
    // -------------------------------------------------------------------
    //
    // The Zod schema requires `items` to have `min(1)`. `parseJson` runs
    // before captcha verification (see route step ordering in
    // `app/src/app/api/reservations/route.ts`), so an empty array short-
    // circuits at the schema layer and is mapped via `validationFailed()`
    // to HTTP 422 + `error.code: "validation_error"` (the lowercase
    // `ErrorCode.Validation` constant from `@/lib/api`).
    it("returns 422 + validation_error for empty items (Req 2.1)", async () => {
        const res = await POST(
            buildRequest("/api/reservations", "POST", {
                body: {
                    items: [],
                    customer: baseCustomer,
                    captchaToken: STUB_CAPTCHA_TOKEN,
                },
            })
        );
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(422);
        expect(json.error.code).toBe("validation_error");
    });

    // -------------------------------------------------------------------
    // Property 3 — Concurrent admission honors stock under contention
    // -------------------------------------------------------------------
    //
    // Feature: testing-strategy-rollout, Property 3: Concurrent admission honors stock under contention
    //
    // Validates: Requirements 2.2 — for any (initialStock ∈ [1, 5],
    // M ∈ [2, 10]), firing M concurrent POST /api/reservations of one
    // unit each on a fresh variant with that stock yields exactly
    // `min(initialStock, M)` HTTP 201 admissions and the rest fail with
    // HTTP 409 + wire `error.code: "out_of_stock"`. Storage post-condition:
    // variant.inventory_quantity = initialStock − min(initialStock, M).
    //
    // The route maps `ReservationError("out_of_stock")` → 409 (see
    // `app/src/app/api/reservations/route.ts`); the `for("update")`
    // row-lock in `lib/reservations.ts` serialises the M parallel
    // transactions, so the property is observable end-to-end.
    //
    // Wire-shape deviation note (matching actual SUT, not the design's
    // `OUT_OF_STOCK` constant name):
    //   `ReservationError` in `lib/reservations.ts` defines `code` as the
    //   union literal `"out_of_stock"` (lowercase). The route forwards
    //   that value verbatim through `fail(error.code, …)`, so the wire
    //   `error.code` is the lowercase string. The design table at
    //   §"`ReservationError` mapping" referred to the constant name
    //   (`OUT_OF_STOCK`), not the wire string — the task brief calls out
    //   this deviation and mandates asserting against the actual
    //   lowercase wire value.
    //
    // Per-iteration tag:
    //   Each iteration mints its own `makeTestTag("p2-conc-…")` so seeded
    //   rows from one iteration cannot leak into the next, AND so the
    //   suite-shared `tag` (used by the example tests above) is left
    //   alone — the file-level `afterAll` only cleans the suite tag.
    //
    // Cleanup contract:
    //   `cleanupReservationRows(localTag)` runs in a `finally` so a
    //   property failure (which fast-check will then shrink) still
    //   removes that iteration's rows. Without this, shrinking would
    //   leave a growing pile of orphan rows that violate the AC 2.12
    //   row-count snapshot.
    //
    // Mocks:
    //   `@/lib/queue` (BullMQ) and the route-helpers / telegram / email
    //   side-effect mocks declared at the top of this file are inherited
    //   unchanged. `setup.ts`'s `applyRateLimit` mock keeps the 100-run
    //   iteration count from burning rate-limit quota (AC 2.7).
    //
    // Cost note (per design §"Cost / iteration budget"):
    //   Generators are `initialStock ∈ [1, 5]` and `M ∈ [2, 10]` per the
    //   spec. Worst case: 10 parallel transactions × 100 iterations =
    //   1000 transactions, plus per-iteration seed + cleanup + inventory
    //   read (~6 sequential round-trips). At ~20-30 ms per transaction
    //   on Neon this property is expected to finish in 3-5 minutes; we
    //   give it 8 minutes of headroom to absorb cold-connection variance
    //   on the integration suite's `singleFork: true` runner — same
    //   pattern as the Property 1 conservation test in
    //   `app/src/lib/reservations.integration.test.ts`. `numRuns` stays
    //   at the 100-run floor enforced by `fcAssert`.
    it("Property 3: M concurrent admissions honor stock under contention (Req 2.2, AC 2.7)", async () => {
        const initialStockArb = fc.integer({ min: 1, max: 5 });
        const concurrencyArb = fc.integer({ min: 2, max: 10 });

        await fcAssert(
            fc.asyncProperty(initialStockArb, concurrencyArb, async (initial, M) => {
                // Reset the in-memory Upstash stub per iteration.
                // `setup.ts` mocks `applyRateLimit` to a no-op
                // already; this is belt-and-braces in case any
                // future test imports the real limiter into this
                // file.
                resetUpstashStub();

                const localTag = makeTestTag("p2-conc");
                try {
                    const fixtures = await seedReservationFixtures(localTag, {
                        inventoryQty: initial,
                    });
                    const variantId = fixtures.variantIds[0];
                    const customer = {
                        firstName: "Тест",
                        lastName: localTag,
                        email: `${localTag}@test.local`,
                        phone: "+70000000000",
                    };

                    // Build M independent `Request` instances and
                    // fire them via `Promise.all` so the M
                    // transactions race for the same `for("update")`
                    // lock on the variant row.
                    const responses = await Promise.all(
                        Array.from({ length: M }, () =>
                            POST(
                                buildRequest("/api/reservations", "POST", {
                                    body: {
                                        items: [
                                            {
                                                variantId,
                                                quantity: 1,
                                            },
                                        ],
                                        customer,
                                        captchaToken: STUB_CAPTCHA_TOKEN,
                                    },
                                })
                            )
                        )
                    );

                    // Tally outcomes. Each response is read once
                    // (its body stream is single-use) and bucketed
                    // by status code.
                    const parsed = await Promise.all(
                        responses.map((res) =>
                            readResponse<ReservationResponseBody | ErrorBody>(res)
                        )
                    );

                    let successes = 0;
                    let outOfStockFailures = 0;
                    for (const { status, json } of parsed) {
                        if (status === 201) {
                            successes += 1;
                            expect((json as ReservationResponseBody).reservation.status).toBe(
                                "pending"
                            );
                        } else if (status === 409) {
                            // The route maps
                            // `ReservationError.code === "out_of_stock"`
                            // to HTTP 409 with the lowercase code
                            // verbatim on the wire (see route
                            // `fail(error.code, …)` and the
                            // example-test deviation note).
                            expect((json as ErrorBody).error.code).toBe("out_of_stock");
                            outOfStockFailures += 1;
                        } else {
                            // Any other status here is a property
                            // violation — surface it loudly so the
                            // shrinker pins the offending status
                            // code in the counter-example.
                            throw new Error(
                                `unexpected response status ${status} ` +
                                    `(initial=${initial}, M=${M}); ` +
                                    `body=${JSON.stringify(json)}`
                            );
                        }
                    }

                    const expectedSuccesses = Math.min(initial, M);
                    expect(successes).toBe(expectedSuccesses);
                    expect(outOfStockFailures).toBe(M - expectedSuccesses);

                    // Storage post-condition: the row-level lock
                    // serialised the decrements, so the final
                    // inventory equals initial − admitted.
                    const [variantRow] = await db
                        .select({
                            qty: productVariants.inventoryQuantity,
                        })
                        .from(productVariants)
                        .where(eq(productVariants.id, variantId))
                        .limit(1);
                    expect(variantRow?.qty ?? 0).toBe(initial - expectedSuccesses);
                } finally {
                    // Per-iteration cleanup. Idempotent — runs
                    // even on a property failure so the next
                    // shrinking attempt starts from a clean
                    // table state and the file-level row-count
                    // snapshot (AC 2.12) holds.
                    await cleanupReservationRows(localTag);
                }
            }),
            { numRuns: 100 }
        );
    }, 480_000);
});
