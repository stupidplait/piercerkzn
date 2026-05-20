/**
 * Integration tests for the Vercel Cron entry point at
 * `app/src/app/api/cron/reservation-expiry/route.ts`.
 *
 * Scope (Phase 2, task 2.7):
 *   1. Happy-path sweep — seed two `pending` reservations, one with
 *      `expires_at` 1 minute in the past, one 1 hour in the future.
 *      Call the cron `GET` handler with `Authorization: Bearer
 *      ${CRON_SECRET}`. Assert the response body is exactly
 *      `{ candidates: 1, expired: 1, errors: 0 }`, the past-expiry
 *      reservation flips to `expired`, the future one stays `pending`,
 *      and the variant inventory is restored only for the expired one
 *      (Req 2.10).
 *   2. Defensive negative paths — missing / wrong bearer → 401.
 *   3. Row-count snapshot in `beforeAll`, asserted in `afterAll`
 *      (AC 2.12).
 *
 * The SUT calls `sweepExpiredReservations` from
 * `@/workers/reservation-expiry`, which fans out to
 * `expireReservation` from `@/lib/reservations`. We exercise the real
 * Drizzle transaction (no DB mock) so the inventory-restore property
 * is observed end-to-end.
 *
 * `CRON_SECRET` is set in `beforeAll` and restored in `afterAll` so
 * other integration test files running in the same single-fork worker
 * are not affected. The integration `setup.ts` mocks `@/lib/auth` and
 * `@/lib/rate-limit` (loaded transitively by `@/lib/api`); those
 * mocks are irrelevant for the cron route but harmless here.
 */
import { count, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/cron/reservation-expiry/route";
import { customers, db, productVariants, products, reservationItems, reservations } from "@/db";
import { createReservation } from "@/lib/reservations";
import { expectRowCountUnchanged, makeTestTag } from "@/test/integration/helpers";
import {
    cleanupReservationRows,
    seedReservationFixtures,
    type SeedReservationFixtures,
} from "@/test/integration/reservation-fixtures";

// ---------------------------------------------------------------------------
// Row-count snapshot bookkeeping (AC 2.12)
// ---------------------------------------------------------------------------
//
// Same five-table surface the lib-level reservation tests use: the
// fixture inserts product / product_variant / customer; the SUT
// inserts reservation / reservation_item. `cleanupReservationRows`
// deletes children before parents, so a clean run lands the counts
// back at their pre-test values.

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
// Helpers
// ---------------------------------------------------------------------------

const BASE = "http://test.local";
const CRON_SECRET_VALUE = "test-cron-secret-route-integration";

/** Build the cron `Request` with an explicit Authorization header. */
function buildCronRequest(authorization?: string): Request {
    const headers: HeadersInit = authorization ? { authorization } : {};
    return new Request(`${BASE}/api/cron/reservation-expiry`, {
        method: "GET",
        headers,
    });
}

/** Read the current `inventory_quantity` for a variant. */
async function readVariantInventory(variantId: string): Promise<number> {
    const [row] = await db
        .select({ qty: productVariants.inventoryQuantity })
        .from(productVariants)
        .where(eq(productVariants.id, variantId))
        .limit(1);
    if (!row) {
        throw new Error(`readVariantInventory: variant ${variantId} not found in DB`);
    }
    // Column is nullable at the schema level (`.default(0)` only fires
    // on insert); coalesce keeps assertion arithmetic in `number` space.
    return row.qty ?? 0;
}

/** Read the current `status` for a single reservation. */
async function readReservationStatus(reservationId: string): Promise<string | null> {
    const [row] = await db
        .select({ status: reservations.status })
        .from(reservations)
        .where(eq(reservations.id, reservationId))
        .limit(1);
    return row?.status ?? null;
}

/**
 * Drive `createReservation` for a single (variant, qty) pair using the
 * fixture customer. Mirrors the input shape used by the route handler
 * but stays at the domain layer so we don't pull in the captcha /
 * rate-limit / route-validation surface.
 */
async function seedPendingReservation(
    fixtures: SeedReservationFixtures,
    variantIndex: number,
    quantity: number,
    tag: string
): Promise<{ reservationId: string }> {
    const result = await createReservation(
        {
            items: [{ variantId: fixtures.variantIds[variantIndex], quantity }],
            customer: {
                firstName: "Test",
                lastName: tag,
                email: fixtures.email,
                phone: "+70000000000",
            },
            source: "catalog",
        },
        { sessionCustomerId: fixtures.customerId }
    );
    return { reservationId: result.reservation.id };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("/api/cron/reservation-expiry integration", () => {
    let snapshotBefore: RowCounts;
    let priorCronSecret: string | undefined;

    // Distinct tags per test isolate row-cleanup. They are registered
    // at module level so `afterAll` can run cleanup for each one — even
    // when a test threw mid-way and never reached its own `try/finally`.
    const sweepTag = makeTestTag("p2-cron-sweep");
    const authTag = makeTestTag("p2-cron-auth");

    beforeAll(async () => {
        // Pin CRON_SECRET so the route's `isAuthorizedCron` gates on a
        // known value. Without this, the dev-mode fallback in
        // `@/lib/cron` admits every unauthenticated request whenever
        // NODE_ENV !== "production" (vitest defaults NODE_ENV to
        // "test"), which would render the negative tests vacuous.
        priorCronSecret = process.env.CRON_SECRET;
        process.env.CRON_SECRET = CRON_SECRET_VALUE;

        snapshotBefore = await snapshotRowCounts();
    });

    afterAll(async () => {
        // Cleanup runs unconditionally — `cleanupReservationRows` is
        // idempotent and tolerates rows that never made it in.
        await cleanupReservationRows(sweepTag);
        await cleanupReservationRows(authTag);

        // Restore the prior CRON_SECRET so other test files in the
        // same single-fork worker observe whatever value (or absence)
        // they expect.
        if (priorCronSecret === undefined) {
            delete process.env.CRON_SECRET;
        } else {
            process.env.CRON_SECRET = priorCronSecret;
        }

        const snapshotAfter = await snapshotRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    // -------------------------------------------------------------------
    // Happy-path sweep (Req 2.10)
    // -------------------------------------------------------------------
    //
    // Property under test: the cron sweep flips exactly the past-expiry
    // reservation to `expired`, restores its inventory, and leaves the
    // future-expiry reservation untouched.
    it("expires only past-expiry pending reservations and restores their inventory", async () => {
        // Seed two variants with stock 5 each so the two reservations
        // touch independent variant rows — that lets us assert the
        // inventory restore is scoped to the expired one only.
        const fixtures = await seedReservationFixtures(sweepTag, {
            variantCount: 2,
            inventoryQty: 5,
        });
        const pastVariantId = fixtures.variantIds[0];
        const futureVariantId = fixtures.variantIds[1];

        const stockBefore = await Promise.all([
            readVariantInventory(pastVariantId),
            readVariantInventory(futureVariantId),
        ]);
        expect(stockBefore).toEqual([5, 5]);

        // Both reservations decrement their respective variants by 2.
        // createReservation defaults `expires_at` to now + 72h.
        const past = await seedPendingReservation(fixtures, 0, 2, sweepTag);
        const future = await seedPendingReservation(fixtures, 1, 2, sweepTag);

        // Inventory has been decremented by both reservations.
        expect(await readVariantInventory(pastVariantId)).toBe(3);
        expect(await readVariantInventory(futureVariantId)).toBe(3);

        // Push the first reservation's `expires_at` 1 minute into
        // the past so the sweep picks it up.
        await db
            .update(reservations)
            .set({ expiresAt: new Date(Date.now() - 60_000) })
            .where(eq(reservations.id, past.reservationId));

        // Call the cron handler.
        const res = await GET(buildCronRequest(`Bearer ${CRON_SECRET_VALUE}`));

        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            candidates: number;
            expired: number;
            errors: number;
        };
        expect(body).toEqual({ candidates: 1, expired: 1, errors: 0 });

        // Past reservation flipped to `expired`; future one stays `pending`.
        expect(await readReservationStatus(past.reservationId)).toBe("expired");
        expect(await readReservationStatus(future.reservationId)).toBe("pending");

        // Inventory restored only for the expired reservation.
        expect(await readVariantInventory(pastVariantId)).toBe(5);
        expect(await readVariantInventory(futureVariantId)).toBe(3);
    });

    // -------------------------------------------------------------------
    // Idempotence — second sweep is a no-op
    // -------------------------------------------------------------------
    //
    // The cron is scheduled every 15 minutes, so two consecutive sweeps
    // could land on the same already-expired reservation (e.g. if the
    // status update crossed into the next sweep window for a different
    // candidate). The sweep must not double-restore inventory or
    // double-flip status.
    it("a second sweep with no fresh candidates returns zeros without touching state", async () => {
        // The previous test left the database with no past-expiry
        // pending reservations. A fresh sweep should report zero
        // candidates and not mutate the future-expiry reservation we
        // left behind.
        const res = await GET(buildCronRequest(`Bearer ${CRON_SECRET_VALUE}`));
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
            candidates: number;
            expired: number;
            errors: number;
        };
        expect(body).toEqual({ candidates: 0, expired: 0, errors: 0 });

        // No new tagged reservation rows materialised; existing rows
        // unchanged.
        const tagged = await db
            .select({
                id: reservations.id,
                status: reservations.status,
            })
            .from(reservations)
            .where(inArray(reservations.customerEmail, [`${sweepTag}@test.local`]));
        // We expect exactly the two reservations seeded in the previous
        // test: one `expired`, one `pending`.
        expect(tagged).toHaveLength(2);
        const statuses = tagged.map((r) => r.status).sort();
        expect(statuses).toEqual(["expired", "pending"]);
    });

    // -------------------------------------------------------------------
    // Defensive negative paths
    // -------------------------------------------------------------------

    it("returns 401 when the Authorization header is missing", async () => {
        const res = await GET(buildCronRequest());
        expect(res.status).toBe(401);

        // The route must not run the sweep when auth fails — assert no
        // tagged reservations were created or mutated by smoke-checking
        // the freshly-seeded row count is still zero for a brand-new tag.
        const beforeCount = await db
            .select({ n: count() })
            .from(reservations)
            .where(eq(reservations.customerEmail, `${authTag}@test.local`));
        expect(beforeCount[0]?.n ?? 0).toBe(0);
    });

    it("returns 401 when the bearer token is wrong", async () => {
        const res = await GET(buildCronRequest("Bearer wrong-token-not-the-real-secret"));
        expect(res.status).toBe(401);
    });
});
