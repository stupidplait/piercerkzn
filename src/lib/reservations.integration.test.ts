/**
 * Integration tests for the reservation transaction layer
 * (`createReservation`, `cancelReservation`, `expireReservation` in
 * `app/src/lib/reservations.ts`).
 *
 * This file exercises the SUT directly against the Test_DB — no HTTP
 * layer involved — so transactional invariants can be asserted
 * independently of route handling. The matching route-level tests live
 * in `app/src/app/api/reservations/route.integration.test.ts`.
 *
 * Scope (Phase 2, task 2.2 — example tests only):
 *   1. Cancel round-trip example (AC 2.5)
 *      Seed → assert decremented → cancel → assert restored to seed.
 *   2. Transactional rollback example (AC 2.9)
 *      Seed two variants → delete one mid-test → call createReservation
 *      with both → assert the first variant's decrement was reverted by
 *      the FK-driven rollback.
 *   3. Row-count snapshot in beforeAll / asserted in afterAll (AC 2.12).
 *
 * The four PBTs that share this file (Property 1 conservation,
 * Property 2 expire idempotence, Property 4 cancel-order metamorphic)
 * are appended in tasks 2.4, 2.5, 2.6 respectively. Placeholder hooks
 * at the bottom of the file mark where they will land.
 *
 * The reservation transaction module never imports `@/lib/queue` or
 * any other side-effect helper directly — those are wired at the route
 * handler boundary. As a result this file does NOT need a `vi.mock` of
 * the queue module: calling `createReservation` exercises only the
 * Drizzle transaction. The integration setup file already mocks
 * `@/lib/auth` and `@/lib/rate-limit` (irrelevant for direct SUT calls
 * but loaded transitively by `@/lib/api`).
 */
import { and, count, eq, sql } from "drizzle-orm";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { customers, db, productVariants, products, reservationItems, reservations } from "@/db";
import {
    cancelReservation,
    createReservation,
    expireReservation,
    ReservationError,
    type CreateReservationDomainInput,
} from "@/lib/reservations";
import { expectRowCountUnchanged, makeTestTag } from "@/test/integration/helpers";
import {
    cleanupReservationRows,
    seedReservationFixtures,
    type SeedReservationFixtures,
} from "@/test/integration/reservation-fixtures";
import { fcAssert } from "@/test/property/fc-config";

// ---------------------------------------------------------------------------
// Row-count snapshot bookkeeping (AC 2.12)
// ---------------------------------------------------------------------------
//
// Snapshot captured in `beforeAll`, re-checked in `afterAll`. The five
// tables below are the entire surface that `seedReservationFixtures`
// + the SUT touch in this file:
//
//   - product / product_variant / customer        — fixture inserts
//   - reservation / reservation_item              — SUT inserts
//
// `cleanupReservationRows(tag)` deletes children before parents (see
// `reservation-fixtures.ts` header), so a clean run lands the counts
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

/**
 * Read the current `inventory_quantity` for a single variant. Used by
 * both example tests to assert decrement / restore / rollback.
 */
async function readVariantInventory(variantId: string): Promise<number> {
    const [row] = await db
        .select({ qty: productVariants.inventoryQuantity })
        .from(productVariants)
        .where(eq(productVariants.id, variantId))
        .limit(1);
    if (!row) {
        throw new Error(`readVariantInventory: variant ${variantId} not found in DB`);
    }
    // The column is nullable at the schema level (`.default(0)` only sets
    // the default on insert), but every fixture-seeded variant carries a
    // concrete number. Defensive coalesce keeps the assertion arithmetic
    // in `number` space.
    return row.qty ?? 0;
}

/**
 * Build the SUT input shape for a fixture customer. Reusable across
 * tests so the contact snapshot stays consistent with `cleanupReservationRows`
 * (which deletes by `customer_email LIKE %tag%`).
 */
function buildInput(
    fixtures: SeedReservationFixtures,
    tag: string,
    items: CreateReservationDomainInput["items"]
): CreateReservationDomainInput {
    return {
        items,
        customer: {
            firstName: "Test",
            lastName: tag,
            email: fixtures.email,
            phone: "+70000000000",
        },
        source: "catalog",
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("lib/reservations integration", () => {
    let snapshotBefore: RowCounts;
    // Distinct tags per test isolate row-cleanup. They are registered at
    // module level so `afterAll` can run cleanup for each one — even when
    // a test threw mid-way and never reached its own `try/finally`.
    const cancelTag = makeTestTag("p2-cancel-rt");
    const rollbackTag = makeTestTag("p2-rollback");

    beforeAll(async () => {
        snapshotBefore = await snapshotRowCounts();
    });

    afterAll(async () => {
        // Cleanup runs unconditionally — `cleanupReservationRows` is
        // idempotent and tolerates rows that never made it in.
        await cleanupReservationRows(cancelTag);
        await cleanupReservationRows(rollbackTag);

        const snapshotAfter = await snapshotRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    // -------------------------------------------------------------------
    // Cancel round-trip example (AC 2.5)
    // -------------------------------------------------------------------
    //
    // Property under test: `cancelReservation` restores the variant's
    // `inventory_quantity` to its pre-creation value. This is the
    // friendly diagnostic that complements Property 1 (conservation
    // invariant, added in task 2.4) — it pins the exact numeric values
    // for the simplest case so a regression in the SUT surfaces with a
    // crisp "expected 5 got 3" rather than buried in a property failure.
    it("create → cancel restores inventory_quantity exactly to the seed value (AC 2.5)", async () => {
        const fixtures = await seedReservationFixtures(cancelTag, {
            inventoryQty: 5,
        });
        const variantId = fixtures.variantIds[0];

        const before = await readVariantInventory(variantId);
        expect(before).toBe(5);

        const result = await createReservation(
            buildInput(fixtures, cancelTag, [{ variantId, quantity: 2 }]),
            { sessionCustomerId: fixtures.customerId }
        );
        expect(result.reservation.status).toBe("pending");
        expect(result.items).toHaveLength(1);

        const afterCreate = await readVariantInventory(variantId);
        expect(afterCreate).toBe(3); // 5 - 2

        const cancelled = await cancelReservation(result.reservation.id, {
            actor: "customer",
            reason: "round-trip test",
        });
        expect(cancelled?.status).toBe("cancelled");

        const afterCancel = await readVariantInventory(variantId);
        expect(afterCancel).toBe(before); // restored exactly to seed
    });

    // -------------------------------------------------------------------
    // Transactional rollback example (AC 2.9)
    // -------------------------------------------------------------------
    //
    // Property under test: when `createReservation` throws mid-transaction
    // — here, after the first variant's inventory was decremented — the
    // entire DB write is rolled back, leaving `inventory_quantity`
    // identical to its pre-call value.
    //
    // FK violation strategy:
    //   The product → variant FK has `onDelete: "cascade"`, so deleting
    //   the parent product would cascade-remove every variant — the
    //   subsequent `createReservation` call would then fail at the very
    //   first `SELECT … FOR UPDATE`, BEFORE any inventory decrement,
    //   making the rollback assertion vacuous.
    //
    //   Instead we seed TWO variants and delete only the second variant
    //   directly. The SUT processes `input.items` sequentially:
    //     1. variant 0 — `SELECT FOR UPDATE` succeeds → inventory
    //        decremented from 5 to 3.
    //     2. variant 1 — `SELECT FOR UPDATE` returns no row →
    //        `ReservationError("variant_not_found")` is thrown, the
    //        Drizzle transaction unwinds, variant 0's decrement is
    //        reverted.
    //   That sequence is observable: variant 0's stored inventory must
    //   be unchanged from its pre-call value (5).
    it("FK violation mid-transaction rolls back variant decrements (AC 2.9)", async () => {
        const fixtures = await seedReservationFixtures(rollbackTag, {
            variantCount: 2,
            inventoryQty: 5,
        });
        const survivingVariantId = fixtures.variantIds[0];
        const doomedVariantId = fixtures.variantIds[1];

        const before = await readVariantInventory(survivingVariantId);
        expect(before).toBe(5);

        // Break the FK precondition for the second item by deleting the
        // variant the SUT will look up second. The product (and the
        // first variant) are untouched, so the SUT still progresses
        // past the first item and writes a real decrement to the DB
        // before the rollback fires.
        await db.delete(productVariants).where(eq(productVariants.id, doomedVariantId));

        await expect(
            createReservation(
                buildInput(fixtures, rollbackTag, [
                    { variantId: survivingVariantId, quantity: 2 },
                    { variantId: doomedVariantId, quantity: 1 },
                ]),
                { sessionCustomerId: fixtures.customerId }
            )
        ).rejects.toThrow(/не найден/);

        const after = await readVariantInventory(survivingVariantId);
        expect(after).toBe(before); // rollback restored the decrement

        // Belt-and-braces: no reservation row should have been
        // committed. Querying by the snapshotted email is sufficient
        // because every fixture customer carries the tagged address.
        const orphanReservations = await db
            .select({ id: reservations.id })
            .from(reservations)
            .where(eq(reservations.customerEmail, fixtures.email));
        expect(orphanReservations).toEqual([]);
    });

    // -------------------------------------------------------------------
    // Property 1 — Conservation of inventory across reservation operations
    // -------------------------------------------------------------------
    //
    // Validates: Requirements 2.5, 2.6, 2.9.
    //
    // For any initial stock K ∈ [1, 10] and any sequence of reservation
    // requests with quantities q₁, q₂, …, qₙ (each qᵢ ∈ [1, 3], n ∈
    // [1, 5]) against a single product variant, after EACH request —
    // whether it succeeded or threw `ReservationError("out_of_stock")` —
    // the storage relation
    //
    //     inventory_quantity + Σ pending_quantity = K
    //
    // SHALL hold over every `reservation_item` belonging to a `pending`
    // reservation on this variant. Failures (out-of-stock, FK rollback)
    // leave both sides of the equation unchanged.
    //
    // Both halves of the equation come from storage:
    //   - `inventory_quantity` from `product_variant`
    //   - `Σ pending_quantity` from `reservation_item` joined to
    //     `reservation` filtered to `status = 'pending'`
    //
    // We deliberately do NOT mirror the running total in test memory —
    // re-deriving the sum from the DB lets a SUT bug that, say,
    // decrements stock without inserting the matching reservation_item
    // surface as a property violation rather than be hidden behind a
    // local accumulator that "agrees with itself".
    //
    // Side-effect mocking (AC 2.7):
    //   `lib/reservations.ts` does NOT import `@/lib/queue` — queue
    //   enqueue lives at the route handler boundary, not the SUT
    //   exercised here — so no queue mock is needed at the lib
    //   boundary. Same for rate-limit (also at the route boundary).
    //   The integration `setup.ts` already stubs `@/lib/auth` and
    //   `@/lib/rate-limit` process-wide as belt-and-braces, so the
    //   100-run iteration count produces zero external side effects.
    //
    // Per-iteration cleanup (`try { … } finally { cleanup }`) is what
    // keeps the file-level row-count snapshot (AC 2.12) intact even
    // when fast-check shrinks a failing run. A fresh tag per iteration
    // means seeded rows from one iteration cannot leak into the next.
    //
    // Generator bounds (lean per task 2.4 brief — tightened from the
    // design's max 25 / 5 / 8 to keep 100 runs under ~25-30 s):
    //   - `initialStockArb`        ∈ [1, 10]
    //   - `requestQuantitiesArb`   = array of int[1, 3], length 1..5
    // Smaller stocks make out-of-stock paths trigger more often, which
    // is exactly the regime where AC 2.9 (rollback preserves the
    // invariant) earns its keep. The shrinker still reaches the
    // minimum failing case (`initial = 1`, `qtys = [1]`) because both
    // arbitraries shrink toward their lower bounds.
    //
    // Per-test timeout: the design's 24-s estimate assumed ~30 ms per
    // Drizzle round-trip. On the Phase-2 integration runner against
    // Neon each iteration (seed + ≤ 8 createReservation calls +
    // post-condition reads + cleanup) takes closer to 2-3 s, so
    // 100 runs land near ~5 minutes. We give the property a generous
    // 8-minute headroom to absorb cold-connection variance — same
    // deviation pattern documented in the concurrent-admission PBT
    // (`route.integration.test.ts` uses 240 s for 100 runs of a
    // smaller iteration body). No other file in this suite hosts a
    // 100-run PBT, so the per-file budget is unaffected.
    //
    // Feature: testing-strategy-rollout, Property 1: Conservation of inventory across reservation operations
    it("Property 1: inventory_quantity + Σ pending_quantity = initialStock after every request (AC 2.5, 2.6, 2.9)", async () => {
        const initialStockArb = fc.integer({ min: 1, max: 10 });
        const requestQuantitiesArb = fc.array(fc.integer({ min: 1, max: 3 }), {
            minLength: 1,
            maxLength: 5,
        });

        await fcAssert(
            fc.asyncProperty(
                initialStockArb,
                requestQuantitiesArb,
                async (initialStock, requestQuantities) => {
                    const perIterTag = makeTestTag("p2-conserve");
                    try {
                        const fixtures = await seedReservationFixtures(perIterTag, {
                            inventoryQty: initialStock,
                            variantCount: 1,
                        });
                        const variantId = fixtures.variantIds[0];

                        for (const q of requestQuantities) {
                            // Call the SUT once per quantity. We
                            // tolerate `out_of_stock` exactly because
                            // the property states the invariant must
                            // hold whether the call succeeded OR
                            // failed. Any OTHER throw (variant_not_
                            // found, invalid input, DB error, …) is
                            // a real bug — re-throw so fast-check
                            // shrinks toward the offending q value.
                            try {
                                await createReservation(
                                    buildInput(fixtures, perIterTag, [{ variantId, quantity: q }]),
                                    {
                                        sessionCustomerId: fixtures.customerId,
                                    }
                                );
                            } catch (err) {
                                if (
                                    !(err instanceof ReservationError) ||
                                    err.code !== "out_of_stock"
                                ) {
                                    throw err;
                                }
                                // Out-of-stock: the SUT rolled back,
                                // no decrement, no pending row.
                                // Continue to the post-condition
                                // read — both sides should be
                                // unchanged from the previous
                                // iteration step.
                            }

                            // Storage post-condition (AFTER the
                            // call returned or threw — never mid-
                            // transaction). Two reads from the DB,
                            // summed and compared.
                            const stock = await readVariantInventory(variantId);
                            const [pendingRow] = await db
                                .select({
                                    sum: sql<number>`coalesce(sum(${reservationItems.quantity}), 0)::int`,
                                })
                                .from(reservationItems)
                                .innerJoin(
                                    reservations,
                                    eq(reservations.id, reservationItems.reservationId)
                                )
                                .where(
                                    and(
                                        eq(reservationItems.variantId, variantId),
                                        eq(reservations.status, "pending")
                                    )
                                );
                            const pendingTotal = pendingRow?.sum ?? 0;

                            expect(stock + pendingTotal).toBe(initialStock);
                        }
                    } finally {
                        // Per-iteration cleanup — runs even on a
                        // property failure so the next shrinking
                        // attempt starts from a clean DB state and
                        // the file-level row-count snapshot
                        // (AC 2.12) holds.
                        await cleanupReservationRows(perIterTag);
                    }
                }
            ),
            { numRuns: 100 }
        );
    }, 480_000);

    // -------------------------------------------------------------------
    // Property 2 — Expire is idempotent
    // -------------------------------------------------------------------
    //
    // Validates: Requirements 2.4.
    //
    // For any reservation R whose status is `pending` and whose
    // `expires_at` is in the past, calling `expireReservation(R.id)`
    // twice in succession SHALL produce exactly one
    // `pending → expired` transition AND SHALL leave the inventory of
    // every variant referenced by R's items in the same state after
    // the second call as after the first. In other words, the second
    // call is a no-op against both the reservation row and the
    // referenced product_variant rows.
    //
    // SUT setup choice — `createReservation` then update `expires_at`:
    //   `createPendingReservationRow` writes the reservation +
    //   reservation_item rows directly but deliberately does NOT
    //   decrement variant inventory (see its JSDoc). The expiry
    //   property hinges on the inverse relationship between create
    //   and expire on the inventory ledger, so we exercise the real
    //   `createReservation` path (which decrements stock) and then
    //   flip `expires_at` to one minute in the past via a direct
    //   Drizzle UPDATE. This mirrors the pattern already used by
    //   `api/cron/reservation-expiry/route.integration.test.ts` and
    //   keeps the property faithful to the production ledger.
    //
    // Side-effect mocking (AC 2.7):
    //   `lib/reservations.ts` does NOT import `@/lib/queue` or
    //   `@/lib/rate-limit` directly — those are wired at the route
    //   handler boundary, not at the SUT exercised here — so no
    //   queue / rate-limit mock is needed at the lib boundary. The
    //   integration `setup.ts` already stubs `@/lib/auth` and
    //   `@/lib/rate-limit` process-wide as belt-and-braces.
    //
    // Per-iteration cleanup (`try { … } finally { cleanup }`) keeps
    // the file-level row-count snapshot (AC 2.12) intact even when
    // fast-check shrinks a failing run. A fresh tag per iteration
    // means seeded rows from one iteration cannot leak into the next.
    //
    // Generator bounds (lean — each iteration runs one
    // createReservation transaction + one UPDATE + two
    // expireReservation transactions + cleanup):
    //   - `initialStockArb`     ∈ [1, 10]
    //   - `requestQuantityArb`  ∈ [1, min(3, initialStock)]
    // The dependent quantity bound prevents wasted iterations where
    // `createReservation` would throw `out_of_stock` — every iteration
    // produces a real reservation that participates in the property.
    // The shrinker still reaches the minimum failing case (`initial =
    // 1`, `q = 1`) because both arbitraries shrink toward their lower
    // bounds.
    //
    // Per-test timeout: each iteration costs ~7 round-trips (seed +
    // createReservation transaction + UPDATE expires_at + 2 expire
    // transactions + 2 inventory reads + cleanup). At ~30 ms per
    // round-trip on Neon that is ~210 ms × 100 iterations ≈ 21 s in
    // the best case; cold-connection variance can stretch this
    // well past a minute. The 480 000 ms (8-min) headroom matches
    // Property 1's choice and absorbs that variance with margin.
    //
    // Feature: testing-strategy-rollout, Property 2: Expire is idempotent
    it("Property 2: expireReservation is idempotent on past-due pending reservations (AC 2.4)", async () => {
        const stockAndQuantityArb = fc.integer({ min: 1, max: 10 }).chain((initialStock) =>
            fc.record({
                initialStock: fc.constant(initialStock),
                requestQuantity: fc.integer({
                    min: 1,
                    max: Math.min(3, initialStock),
                }),
            })
        );

        await fcAssert(
            fc.asyncProperty(stockAndQuantityArb, async ({ initialStock, requestQuantity }) => {
                const perIterTag = makeTestTag("p2-expire-idem");
                try {
                    const fixtures = await seedReservationFixtures(perIterTag, {
                        inventoryQty: initialStock,
                        variantCount: 1,
                    });
                    const variantId = fixtures.variantIds[0];

                    // Drive the real reservation creation path
                    // so the variant ledger is decremented the
                    // way production decrements it.
                    const created = await createReservation(
                        buildInput(fixtures, perIterTag, [
                            {
                                variantId,
                                quantity: requestQuantity,
                            },
                        ]),
                        {
                            sessionCustomerId: fixtures.customerId,
                        }
                    );
                    const reservationId = created.reservation.id;
                    expect(created.reservation.status).toBe("pending");

                    // Pre-condition: createReservation
                    // decremented the variant by exactly the
                    // requested quantity. This is the baseline
                    // expireReservation needs to restore.
                    const stockAfterCreate = await readVariantInventory(variantId);
                    expect(stockAfterCreate).toBe(initialStock - requestQuantity);

                    // Flip `expires_at` into the past so
                    // expireReservation will accept the row.
                    // Using a direct Drizzle UPDATE here
                    // mirrors `api/cron/reservation-expiry/
                    // route.integration.test.ts`.
                    await db
                        .update(reservations)
                        .set({
                            expiresAt: new Date(Date.now() - 60_000),
                        })
                        .where(eq(reservations.id, reservationId));

                    // First expire — observes the
                    // pending → expired transition AND
                    // restores inventory.
                    const firstResult = await expireReservation(reservationId);
                    expect(firstResult?.status).toBe("expired");
                    const stockAfterFirstExpire = await readVariantInventory(variantId);
                    expect(stockAfterFirstExpire).toBe(initialStock);

                    // Second expire — must be a no-op against
                    // both the reservation status (already
                    // expired) and the variant inventory
                    // (already restored). A non-idempotent
                    // implementation would either re-run the
                    // restore (inventory > initialStock) or
                    // throw on the already-expired row.
                    const secondResult = await expireReservation(reservationId);
                    expect(secondResult?.status).toBe("expired");

                    const stockAfterSecondExpire = await readVariantInventory(variantId);
                    expect(stockAfterSecondExpire).toBe(stockAfterFirstExpire);

                    // Belt-and-braces — re-read the row from
                    // storage to confirm the SUT did not
                    // mutate it on the second call (e.g. a
                    // bug that rewrote `expiredAt` without
                    // changing the status would still be a
                    // violation worth catching).
                    const [storedRow] = await db
                        .select({ status: reservations.status })
                        .from(reservations)
                        .where(eq(reservations.id, reservationId))
                        .limit(1);
                    expect(storedRow?.status).toBe("expired");
                } finally {
                    // Per-iteration cleanup — runs even on a
                    // property failure so the next shrinking
                    // attempt starts from a clean DB state
                    // and the file-level row-count snapshot
                    // (AC 2.12) holds.
                    await cleanupReservationRows(perIterTag);
                }
            }),
            { numRuns: 100 }
        );
    }, 480_000);

    // -------------------------------------------------------------------
    // Property 4 — Cancel order is irrelevant (metamorphic)
    // -------------------------------------------------------------------
    //
    // Validates: Requirements 2.7, 2.8.
    //
    // For any pending reservation R with items [i₁, i₂, …, iₙ] and any
    // permutation π of those items, the cumulative restored inventory
    // after `cancelReservation(R.id)` SHALL be identical to the
    // cumulative restored inventory after cancelling a logically
    // equivalent reservation R' whose items were inserted in the
    // permuted order. That is, cancel is invariant under item
    // ordering — a metamorphic property over the cancel transaction's
    // per-variant `inventory_quantity += item.quantity` loop.
    //
    // Realisation strategy:
    //   The strongest observable form of this property is "for any
    //   ordering of items in a successful create+cancel round trip,
    //   the variant ledger lands exactly back at the seed value". Two
    //   independent runs (one with `items`, one with the permuted
    //   list) are executed against fresh fixtures; both runs are then
    //   compared against the seed AND against each other. If cancel
    //   were order-dependent, at least one run would diverge.
    //
    // Seed sizing:
    //   `inventoryQty: 100` is intentionally far above the per-item
    //   max quantity (3) × max items (4) = 12 so create never short-
    //   circuits with `out_of_stock` (which would skip the cancel and
    //   make the property vacuous). Using distinct variantIndexes per
    //   item — one variant per array position — keeps the property
    //   semantics tight: each item touches its own variant, so the
    //   per-variant cancel UPDATEs are independent and any ordering
    //   bug in the cancel loop manifests as a per-variant divergence.
    //
    // Side-effect mocking (AC 2.7):
    //   `lib/reservations.ts` does NOT import `@/lib/queue` or
    //   `@/lib/rate-limit` directly — those are wired at the route
    //   handler boundary, not at the SUT exercised here — so no
    //   queue / rate-limit mock is needed at the lib boundary. The
    //   integration `setup.ts` already stubs `@/lib/auth` and
    //   `@/lib/rate-limit` process-wide as belt-and-braces, so the
    //   100-run iteration count produces zero external side effects.
    //
    // Per-iteration cleanup keeps the file-level row-count snapshot
    // (AC 2.12) intact even when fast-check shrinks a failing run.
    // Two distinct tags per iteration (`-orig` / `-perm`) so the two
    // runs cannot stomp on each other's reservation rows.
    //
    // Generator bounds (lean — each iteration runs TWO full
    // create+cancel transactions plus seed/cleanup, so we keep the
    // per-iteration round-trip count low):
    //   - `quantitiesArb`        = array of int[1, 3], length 2..4
    //   - `permutationArb`       = sort-by-random-key, stable in the
    //                              presence of duplicate keys via the
    //                              original-index tie-breaker.
    // Each item in the array carries its position as `variantIndex`,
    // so `items.length === variantCount` and every variant is
    // referenced exactly once by the original-order list.
    //
    // Per-test timeout: each iteration costs ~14-18 round-trips
    // (2 × (seed + create + cancel + N inventory reads + cleanup)).
    // Empirically, Property 1 runs ~5.5 min for 100 iterations of a
    // single create-loop with one variant; Property 4 doubles that
    // (two full create+cancel cycles per iteration, 2..4 variants
    // per fixture) so the realistic best-case is ~10-12 min on Neon
    // and cold-connection variance can push past 14 min. The
    // 960 000 ms (16-min) headroom absorbs that variance — Property
    // 1's tighter budget did not, see the run that timed out at
    // 480 009 ms when this property was first exercised.
    //
    // Feature: testing-strategy-rollout, Property 4: Cancel order is irrelevant (metamorphic)
    it("Property 4: cancel restores inventory identically under any item ordering (AC 2.7, 2.8)", async () => {
        // Permutation arbitrary — sorts items by an integer key
        // generated alongside them. The original-index tie-breaker
        // keeps the sort stable when fast-check shrinks two seeds
        // to the same value, so shrinking converges deterministically.
        const permutationArb = <T>(arr: T[]): fc.Arbitrary<T[]> =>
            fc
                .array(fc.integer(), {
                    minLength: arr.length,
                    maxLength: arr.length,
                })
                .map((seeds) =>
                    arr
                        .map((value, idx) => ({ value, key: seeds[idx], idx }))
                        .sort((a, b) => a.key - b.key || a.idx - b.idx)
                        .map((entry) => entry.value)
                );

        // Each array position becomes a `variantIndex`, so the
        // generated items always reference distinct variants and
        // `items.length === variantCount`. The permuted list
        // carries the same items in shuffled order, exercising
        // the cancel-loop's per-variant UPDATE sequence.
        const itemsAndPermutationArb = fc
            .array(fc.integer({ min: 1, max: 3 }), {
                minLength: 2,
                maxLength: 4,
            })
            .map((qtys) =>
                qtys.map((quantity, variantIndex) => ({
                    variantIndex,
                    quantity,
                }))
            )
            .chain((items) => fc.tuple(fc.constant(items), permutationArb(items)));

        const SEED_INVENTORY = 100;

        // Run a single create+cancel round-trip against a freshly
        // seeded fixture. Returns the per-variant inventory
        // snapshot read after the cancel commits, in stable
        // `fixtures.variantIds` order.
        const runOnce = async (
            tag: string,
            order: ReadonlyArray<{
                variantIndex: number;
                quantity: number;
            }>,
            variantCount: number
        ): Promise<number[]> => {
            const fixtures = await seedReservationFixtures(tag, {
                variantCount,
                inventoryQty: SEED_INVENTORY,
            });
            try {
                const sutItems = order.map((it) => ({
                    variantId: fixtures.variantIds[it.variantIndex],
                    quantity: it.quantity,
                }));

                const created = await createReservation(buildInput(fixtures, tag, sutItems), {
                    sessionCustomerId: fixtures.customerId,
                });
                expect(created.reservation.status).toBe("pending");

                const cancelled = await cancelReservation(created.reservation.id, {
                    actor: "customer",
                    reason: "cancel-order metamorphic test",
                });
                expect(cancelled?.status).toBe("cancelled");

                // Read every seeded variant's inventory in stable
                // index order so the two runs are directly
                // comparable element-by-element.
                return Promise.all(fixtures.variantIds.map((vid) => readVariantInventory(vid)));
            } finally {
                // Per-run cleanup — runs even if the SUT threw,
                // so a property failure on one run does not leak
                // rows into the next iteration's snapshot.
                await cleanupReservationRows(tag);
            }
        };

        await fcAssert(
            fc.asyncProperty(itemsAndPermutationArb, async ([items, permutedItems]) => {
                const variantCount = items.length;
                const tagOriginal = makeTestTag("p2-cancel-meta-orig");
                const tagPermuted = makeTestTag("p2-cancel-meta-perm");

                const stocksOriginal = await runOnce(tagOriginal, items, variantCount);
                const stocksPermuted = await runOnce(tagPermuted, permutedItems, variantCount);

                // Metamorphic invariant — the per-variant
                // restored inventory is identical regardless
                // of the order items were inserted into the
                // reservation. Two complementary assertions:
                //
                //   (a) Both runs return ALL variants to the
                //       seed value. This is the absolute
                //       form of the property — any divergence
                //       at all is a violation.
                //   (b) The two runs produce identical
                //       snapshots. Redundant with (a) given
                //       the seed equality, but explicit to
                //       document the metamorphic relation.
                const expected = new Array(variantCount).fill(SEED_INVENTORY);
                expect(stocksOriginal).toEqual(expected);
                expect(stocksPermuted).toEqual(expected);
                expect(stocksOriginal).toEqual(stocksPermuted);
            }),
            { numRuns: 100 }
        );
    }, 960_000);
});
