/**
 * Integration tests for the public review surface (Phase 3, task 3.8).
 *
 * The "reviews" route surface is split across two files:
 *
 *   POST /api/products/[handle]/reviews     — submit a new product review
 *                                              (`./products/[handle]/reviews/route.ts`)
 *   POST /api/reviews/[id]/helpful          — mark a review as helpful
 *                                              (`./reviews/[id]/helpful/route.ts`)
 *
 * The task description ("POST /api/reviews") is approximate; the design
 * §"Phase 3" per-route table maps `reviews/route.ts` to the two FK-bound
 * handlers above, so this file exercises both. There is no
 * `app/src/app/api/reviews/route.ts` (i.e. no plain
 * `POST /api/reviews`); the storefront submits reviews via the
 * product-handle nested route, and votes via the review-id nested route.
 *
 * Imports the route handlers directly and calls them with synthetic
 * `Request` objects (no HTTP server), per the established convention
 * under `src/app/api/**\/*.integration.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * Scope (4 tests, per task 3.8)
 * ---------------------------------------------------------------------------
 *   1. Create review happy path  — auth mocked, POST a valid body
 *                                  (rating, title, content), expect 201 +
 *                                  the inserted row reachable in storage
 *                                  with `status: "pending"` (Req 3.1, 3.2).
 *   2. Create review invalid body — auth mocked, POST `{}` (rating is
 *                                  required by `createProductReviewSchema`),
 *                                  expect 422 + `error.code: "validation_error"`
 *                                  with a `rating` path in `details`
 *                                  (Req 3.4, 3.5).
 *   3. Helpful-vote happy path   — seed an approved review for another
 *                                  customer, auth as the seeded "voter"
 *                                  customer, POST helpful, expect 200 +
 *                                  `alreadyVoted: false` and a single
 *                                  vote row reachable in storage; the
 *                                  parent review's `helpfulCount` bumps
 *                                  by exactly 1 (Req 3.1, 3.2, 3.3).
 *   4. Duplicate helpful-vote    — same voter posts again. The route
 *                                  is documented (file header in
 *                                  `helpful/route.ts`) as **idempotent**:
 *                                  it returns `200 + alreadyVoted: true`
 *                                  WITHOUT changing the counter — NOT
 *                                  HTTP 409 as the task description
 *                                  mentions. The substantive assertion
 *                                  here is therefore "no second vote row
 *                                  + helpfulCount unchanged at 1", which
 *                                  is the exact invariant a 409 would
 *                                  also have protected. See the inline
 *                                  comment in test #4 for the deviation
 *                                  rationale (Req 3.1, 3.2, 3.3).
 *
 * ---------------------------------------------------------------------------
 * Verified-client gate
 * ---------------------------------------------------------------------------
 *
 *   `POST /api/products/[handle]/reviews` calls
 *   `isVerifiedStudioClient(customerId)` from `@/lib/reviews`, which
 *   resolves true iff the customer has at least one `picked_up`
 *   reservation OR one `completed` appointment. A customer that fails
 *   this check is rejected with 403 / `not_verified_client` BEFORE the
 *   schema even runs, so the happy path test below directly seeds a
 *   `picked_up` reservation row tagged to the customer to make the
 *   gate fall through. The bare reservation has no `reservation_item`
 *   rows attached (the gate doesn't read items), which keeps the
 *   cleanup chain simple — no variant references are pinned.
 *
 * ---------------------------------------------------------------------------
 * Mock surface
 * ---------------------------------------------------------------------------
 *
 *   `setup.ts` already mocks `@/lib/auth`, `@/lib/rate-limit`, and
 *   `@/lib/api` process-wide. Customer-scoped tests flip the
 *   `auth() → null` default per-test via
 *   `authMock.mockResolvedValueOnce(...)`, mirroring the narrowing
 *   pattern landed in `src/app/api/customers/me/route.integration.test.ts`
 *   and `src/app/api/wishlist/route.integration.test.ts`.
 *
 *   This file additionally hoists a single route-specific mock:
 *
 *   - `@/lib/posthog` — both routes fire `capture()` on the success
 *     paths (`product_review_submitted`, `review_helpful_voted`).
 *     `posthog.ts` short-circuits when `POSTHOG_API_KEY` is missing, but
 *     stubbing keeps the suite deterministic regardless of local env.
 *
 * ---------------------------------------------------------------------------
 * Cleanup strategy (Req 3.8 — tagged-cleanup with row-count parity)
 * ---------------------------------------------------------------------------
 *
 *   Schema FK audit:
 *     review.customer_id          → customers.id  (notNull, NO cascade)
 *     review.product_id           → products.id   (CASCADE)
 *     review_helpful_vote.review_id  → review.id     (CASCADE)
 *     review_helpful_vote.customer_id → customers.id (CASCADE)
 *
 *   The `customer.id` FK on `review` has no `ON DELETE` clause, so
 *   deleting a tagged customer while reviews still reference it would
 *   fail with `foreign_key_violation`. The cleanup chain therefore
 *   deletes reviews owned by tagged customers FIRST (which cascades
 *   review_helpful_vote rows away), and then delegates to
 *   `cleanupReservationRows(tag)` which already handles
 *   reservations → customers → variants → products in the correct
 *   order.
 *
 *   The product-side review cascade (`review.product_id ON DELETE
 *   CASCADE`) would otherwise be enough, BUT
 *   `cleanupReservationRows` deletes customers BEFORE products, so we
 *   can't rely on the product-cascade alone. The explicit
 *   review-by-customer pre-delete is the cheapest fix.
 */
import { and, count, eq, inArray, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as POST_REVIEW } from "../products/[handle]/reviews/route";
import { POST as POST_HELPFUL } from "./[id]/helpful/route";
import { auth } from "@/lib/auth";
import { customers, db, products, reservations, reviewHelpfulVotes, reviews } from "@/db";
import {
    cleanupReservationRows,
    seedReservationFixtures,
} from "@/test/integration/reservation-fixtures";
import {
    buildRequest,
    expectRowCountUnchanged,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

// `auth` from `next-auth` v5 is an overloaded function (route-handler
// wrapper, middleware, AND session getter). The integration `setup.ts`
// stub exposes it as the session-getter form (`async () => Session | null`),
// so for `vi.mocked(...)` ergonomics we narrow the export to that single
// signature here. This affects only the mock-control surface in this
// file — the production import path is unchanged. Same pattern as
// `src/app/api/customers/me/route.integration.test.ts` and
// `src/app/api/wishlist/route.integration.test.ts`.
const authMock = vi.mocked(
    auth as unknown as () => Promise<{
        user: {
            id: string;
            customerId?: string;
            role?: "customer" | "admin" | "staff";
        };
    } | null>
);

// ---------------------------------------------------------------------------
// Module mocks (route-specific)
// ---------------------------------------------------------------------------
//
// `vi.mock` calls are hoisted by Vitest to the top of the module, before
// any of the imports above are resolved. That is how the real route
// imports below see the stubbed `@/lib/posthog` rather than the
// production module.

vi.mock("@/lib/posthog", () => ({
    capture: vi.fn(),
    flush: vi.fn(async () => undefined),
    posthog: null,
    getPostHogSessionId: vi.fn(() => null),
}));

// ---------------------------------------------------------------------------
// Fixtures and shared state
// ---------------------------------------------------------------------------

/** Tag shared by every test in this file — single cleanup at `afterAll`. */
const tag = makeTestTag("p3-reviews");

interface ErrorBody {
    error: { code: string; message: string; details?: unknown };
}

interface ReviewCreateBody {
    review: {
        id: string;
        rating: number;
        title: string | null;
        content: string | null;
        status: string;
        isVerifiedClient: boolean;
        helpfulCount: number;
        createdAt: string;
    };
    message: string;
}

interface HelpfulBody {
    review: { id: string; helpfulCount: number };
    alreadyVoted: boolean;
}

// ---------------------------------------------------------------------------
// Row-count snapshot bookkeeping (Req 3.8)
// ---------------------------------------------------------------------------
//
// Mirrors the pattern from `src/app/api/customers/me/route.integration.test.ts`
// and `src/app/api/wishlist/route.integration.test.ts`. The five tracked
// tables — customers, products, reservations, reviews, review_helpful_vote —
// are shared with the dev environment AND with sibling integration test
// files that may run alongside. A bare `count()` on those tables would
// diverge under concurrent activity even when this suite's cleanup is
// perfect.
//
// Instead the snapshot below counts ONLY rows this suite owns — those
// reachable from the suite-wide tag prefix:
//
//   tagged_customer       — customer.email LIKE %tag%
//   tagged_product        — product.handle LIKE %tag%
//   tagged_reservation    — reservation.customer_email LIKE %tag%
//   tagged_review         — review.customer_id ∈ (tagged customers)
//   tagged_helpful_vote   — review_helpful_vote.customer_id ∈ (tagged customers)
//
// Before any test runs, all five tagged counts are `0`; after
// `afterAll` cleanup, all five must be `0` again.

type RowCounts = Record<string, number>;

async function snapshotTaggedRowCounts(): Promise<RowCounts> {
    // Resolve tagged customer ids first — both the review and helpful
    // counts pivot on this set. Empty short-circuit returns zero
    // counts without firing the `inArray` query (which would be
    // legal but wasteful).
    const taggedCustomerIds = (
        await db
            .select({ id: customers.id })
            .from(customers)
            .where(like(customers.email, `%${tag}%`))
    ).map((r) => r.id);

    const reviewCountQuery =
        taggedCustomerIds.length > 0
            ? db
                  .select({ n: count() })
                  .from(reviews)
                  .where(inArray(reviews.customerId, taggedCustomerIds))
            : Promise.resolve([{ n: 0 }]);

    const helpfulCountQuery =
        taggedCustomerIds.length > 0
            ? db
                  .select({ n: count() })
                  .from(reviewHelpfulVotes)
                  .where(inArray(reviewHelpfulVotes.customerId, taggedCustomerIds))
            : Promise.resolve([{ n: 0 }]);

    const [[customerRow], [productRow], [reservationRow], [reviewRow], [helpfulRow]] =
        await Promise.all([
            db
                .select({ n: count() })
                .from(customers)
                .where(like(customers.email, `%${tag}%`)),
            db
                .select({ n: count() })
                .from(products)
                .where(like(products.handle, `%${tag}%`)),
            db
                .select({ n: count() })
                .from(reservations)
                .where(like(reservations.customerEmail, `%${tag}%`)),
            reviewCountQuery,
            helpfulCountQuery,
        ]);

    return {
        tagged_customer: customerRow.n,
        tagged_product: productRow.n,
        tagged_reservation: reservationRow.n,
        tagged_review: reviewRow.n,
        tagged_helpful_vote: helpfulRow.n,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("/api/reviews integration", () => {
    let snapshotBefore: RowCounts;
    let fixtures: Awaited<ReturnType<typeof seedReservationFixtures>>;
    /**
     * Author of the **pre-seeded approved review** that tests #3 and
     * #4 vote on. Distinct from `fixtures.customerId` for two reasons:
     *
     *   1. Test #1 (review-create happy path) calls
     *      `POST /api/products/[handle]/reviews` for `fixtures.customerId`
     *      on `fixtures.productId`. The route enforces a "one review
     *      per (customer, product, type)" guard at the application
     *      layer (returns 409 / `already_reviewed`). If
     *      `fixtures.customerId` ALSO authored the pre-seeded
     *      approved review on the same product, test #1 would land
     *      in the guard and fail with 409 instead of inserting.
     *      Splitting authorship across two customers eliminates that
     *      collision.
     *
     *   2. The helpful-vote tests then forge `fixtures.customerId` as
     *      the **voter** — voting on someone else's review keeps the
     *      author/voter pair distinct. The SUT does not currently
     *      disallow self-voting, but the test stays cleaner this way.
     */
    let seededReviewAuthorId = "";
    let seededReviewAuthorEmail = "";
    /** Pre-seeded approved review used by tests #3 and #4. */
    let seededReviewId = "";

    beforeAll(async () => {
        snapshotBefore = await snapshotTaggedRowCounts();

        // Seed the canonical product / variant / customer triple via
        // the Phase 1 fixture. The customer here is the *review
        // author* in test #1.
        fixtures = await seedReservationFixtures(tag);

        // Insert a `picked_up` reservation tied to the author so that
        // `isVerifiedStudioClient(authorId)` falls through. The
        // reservation has no `reservation_item` rows — the gate only
        // queries the `reservations` table by status. Tagged
        // `customer_email` makes `cleanupReservationRows(tag)` pick it
        // up at suite teardown.
        await db.insert(reservations).values({
            // Use a tag-recognisable but valid 20-char reference. The
            // production format is `PK-RES-YYYY-NNNN`; the `T-` infix
            // marks this as a test-only row. Same shape as
            // `createPendingReservationRow` in
            // `reservation-fixtures.ts`.
            referenceNumber: `PK-RES-T-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
            customerId: fixtures.customerId,
            customerFirstName: "Test",
            customerLastName: tag,
            customerEmail: fixtures.email,
            customerPhone: "+70000000000",
            status: "picked_up",
            total: 0,
            // `expires_at` is `notNull` even for picked-up rows; use
            // any past timestamp.
            expiresAt: new Date(Date.now() - 60_000),
        });

        // Seed a second tagged customer to play the **author of the
        // pre-seeded approved review** in tests #3 and #4. We bypass
        // `createCustomerForReservation` (which hashes a password via
        // Argon2) — the helpful-vote route does not exercise the
        // password column, and this customer never authenticates, so
        // a plain insert is faster and the cleanup-by-email predicate
        // still matches.
        seededReviewAuthorEmail = `${tag}-author2@test.local`;
        const [author2] = await db
            .insert(customers)
            .values({
                email: seededReviewAuthorEmail,
                firstName: `${tag}-author2`,
                lastName: tag,
            })
            .returning({ id: customers.id });
        seededReviewAuthorId = author2.id;

        // Seed an `approved` review on the tagged product, authored
        // by the secondary tagged customer. Tests #3 and #4 vote on
        // this row using `fixtures.customerId` as the voter. Direct
        // Drizzle insert (not via the SUT) so the helpful tests are
        // independent of the create-review code path exercised in
        // test #1, AND so the author here does NOT collide with
        // `fixtures.customerId`'s own review insert in test #1.
        const [seededReview] = await db
            .insert(reviews)
            .values({
                type: "product",
                productId: fixtures.productId,
                customerId: seededReviewAuthorId,
                rating: 5,
                title: `${tag}-seeded`,
                content: "Seeded review for helpful-vote tests.",
                isVerifiedClient: true,
                helpfulCount: 0,
                status: "approved",
            })
            .returning({ id: reviews.id });
        seededReviewId = seededReview.id;
    });

    afterAll(async () => {
        // Step 1 — delete reviews owned by tagged customers FIRST so
        // the customer DELETE in `cleanupReservationRows` doesn't
        // trip `review.customer_id` (notNull, NO cascade). This also
        // cascades `review_helpful_vote` rows away via
        // `review_helpful_vote.review_id ON DELETE CASCADE`.
        const taggedCustomerIds = (
            await db
                .select({ id: customers.id })
                .from(customers)
                .where(like(customers.email, `%${tag}%`))
        ).map((r) => r.id);
        if (taggedCustomerIds.length > 0) {
            await db.delete(reviews).where(inArray(reviews.customerId, taggedCustomerIds));
            // Belt-and-braces — also drop any vote rows authored by
            // tagged customers that haven't already cascaded (e.g.
            // votes on reviews authored by some other, non-tagged
            // customer — none in this suite, but the predicate is
            // cheap and safe).
            await db
                .delete(reviewHelpfulVotes)
                .where(inArray(reviewHelpfulVotes.customerId, taggedCustomerIds));
        }

        // Step 2 — standard reservation-domain cleanup. Deletes
        // tagged reservations → customers → variants → products in
        // FK-safe order.
        await cleanupReservationRows(tag);

        const snapshotAfter = await snapshotTaggedRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    afterEach(() => {
        // Reset the auth mock back to the setup.ts default (no
        // session) so a leaked `mockResolvedValueOnce` cannot cross
        // test boundaries. Same pattern as the customers/me and
        // wishlist suites.
        authMock.mockReset();
        authMock.mockResolvedValue(null);
    });

    // -------------------------------------------------------------------
    // Test 1 — Create review happy path (Req 3.1, 3.2, 3.3)
    // -------------------------------------------------------------------
    //
    // Forge a session for the seeded fixtures customer (the verified
    // client thanks to the `picked_up` reservation seeded in
    // `beforeAll`), POST a valid body to
    // `/api/products/[handle]/reviews`, expect 201 + a `pending` row
    // reachable in storage.
    it("POST /products/[handle]/reviews creates a pending review with 201 (Req 3.1, 3.2, 3.3)", async () => {
        authMock.mockResolvedValueOnce({
            user: {
                id: fixtures.customerId,
                customerId: fixtures.customerId,
                role: "customer",
            },
        });

        const handle = `${tag}-prod`;
        const res = await POST_REVIEW(
            buildRequest(`/api/products/${handle}/reviews`, "POST", {
                body: {
                    rating: 5,
                    title: "Excellent jewelry",
                    content: "Beautiful titanium piece, healed quickly.",
                },
            }),
            { params: Promise.resolve({ handle }) }
        );
        const { status, json } = await readResponse<ReviewCreateBody>(res);

        expect(status).toBe(201);
        expect(json.review.rating).toBe(5);
        expect(json.review.title).toBe("Excellent jewelry");
        // The route inserts with `status: "pending"` regardless of
        // input — the customer cannot self-approve. This is the
        // moderation guard documented in `validations/review.ts`.
        expect(json.review.status).toBe("pending");
        // Verified-client flag is set true because the `beforeAll`
        // seeded a `picked_up` reservation for this customer.
        expect(json.review.isVerifiedClient).toBe(true);

        // Reachability: the inserted row must be queryable via the
        // (customer, product, type) selector the SUT itself uses for
        // the "already reviewed" guard.
        const [stored] = await db
            .select({
                id: reviews.id,
                status: reviews.status,
                rating: reviews.rating,
            })
            .from(reviews)
            .where(
                and(
                    eq(reviews.customerId, fixtures.customerId),
                    eq(reviews.productId, fixtures.productId),
                    eq(reviews.type, "product")
                )
            )
            .limit(1);
        expect(stored?.id).toBe(json.review.id);
        expect(stored?.status).toBe("pending");
        expect(stored?.rating).toBe(5);
    });

    // -------------------------------------------------------------------
    // Test 2 — Create review invalid body → 422 + validation_error
    //          (Req 3.4, 3.5)
    // -------------------------------------------------------------------
    //
    // `createProductReviewSchema` requires `rating` (int 1..5). POSTing
    // `{}` makes the schema fail at the `rating` path; `parseJson` →
    // `validationFailed` returns HTTP 422 + `error.code: "validation_error"`
    // and surfaces the failing path in `details`.
    //
    // Note the route's order of operations: `applyRateLimit` →
    // `requireUser` → `parseJson`. We need to forge a session here so
    // we land on `parseJson`'s validation branch rather than the 401
    // unauthorised one.
    it("POST /products/[handle]/reviews returns 422 + validation_error for an empty body (Req 3.4, 3.5)", async () => {
        authMock.mockResolvedValueOnce({
            user: {
                id: fixtures.customerId,
                customerId: fixtures.customerId,
                role: "customer",
            },
        });

        const handle = `${tag}-prod`;
        const res = await POST_REVIEW(
            buildRequest(`/api/products/${handle}/reviews`, "POST", {
                // Empty object — `rating` is required. `parseJson`
                // returns 422 / `validation_error`.
                body: {},
            }),
            { params: Promise.resolve({ handle }) }
        );
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(422);
        expect(json.error.code).toBe("validation_error");
        const details = json.error.details as Array<{ path: string }> | undefined;
        // The failing path must include `rating` so callers can render
        // a field-level error in the UI.
        expect(details?.some((d) => d.path === "rating")).toBe(true);
    });

    // -------------------------------------------------------------------
    // Test 3 — Helpful-vote happy path (Req 3.1, 3.2, 3.3)
    // -------------------------------------------------------------------
    //
    // Auth as the seeded fixtures customer (the verified client) and
    // POST `/api/reviews/${seededReviewId}/helpful`. The pre-seeded
    // review was authored by a *different* tagged customer
    // (`seededReviewAuthorId`) so this is not a self-vote. The route
    // inserts a row in `review_helpful_vote` AND bumps
    // `review.helpful_count` from 0 → 1 in the same transaction. The
    // response surface is `{ review: { helpfulCount }, alreadyVoted }`.
    it("POST /reviews/[id]/helpful records a vote and bumps helpfulCount (Req 3.1, 3.2, 3.3)", async () => {
        authMock.mockResolvedValueOnce({
            user: {
                id: fixtures.customerId,
                customerId: fixtures.customerId,
                role: "customer",
            },
        });

        const res = await POST_HELPFUL(
            buildRequest(`/api/reviews/${seededReviewId}/helpful`, "POST", {}),
            { params: Promise.resolve({ id: seededReviewId }) }
        );
        const { status, json } = await readResponse<HelpfulBody>(res);

        expect(status).toBe(200);
        expect(json.alreadyVoted).toBe(false);
        // `helpfulCount` returned in the response reflects the
        // post-increment value.
        expect(json.review.helpfulCount).toBe(1);

        // Storage check: exactly one vote row for this (review, voter)
        // pair, and the parent review's column was actually written.
        const [{ n: voteCount }] = await db
            .select({ n: count() })
            .from(reviewHelpfulVotes)
            .where(
                and(
                    eq(reviewHelpfulVotes.reviewId, seededReviewId),
                    eq(reviewHelpfulVotes.customerId, fixtures.customerId)
                )
            );
        expect(voteCount).toBe(1);

        const [persisted] = await db
            .select({ helpfulCount: reviews.helpfulCount })
            .from(reviews)
            .where(eq(reviews.id, seededReviewId))
            .limit(1);
        expect(persisted?.helpfulCount).toBe(1);
    });

    // -------------------------------------------------------------------
    // Test 4 — Duplicate helpful-vote → idempotent (Req 3.1, 3.2, 3.3)
    // -------------------------------------------------------------------
    //
    // The task description for 3.8 says "duplicate vote → 409", but
    // the actual SUT contract documented in `helpful/route.ts` is
    // explicitly **idempotent** — a second vote returns `200 +
    // alreadyVoted: true` WITHOUT bumping the counter. Quoting the
    // route's file header:
    //
    //   > A double-vote returns `200 alreadyVoted=true` without
    //   > changing the counter.
    //
    // The substantive invariant a 409 would have protected — "a
    // second vote does not double-count" — is checked here directly:
    //
    //   * exactly ONE `review_helpful_vote` row exists for the
    //     (review, customer) pair AFTER the second call
    //   * `review.helpful_count` is unchanged at 1 AFTER the second
    //     call
    //
    // Switching the SUT to return 409 would be a production-code
    // change outside this task's scope (file path constraint:
    // `route.integration.test.ts` only). If the team decides 409 is
    // the right contract, the route + this test should be updated
    // together in a follow-up.
    it("POST /reviews/[id]/helpful is idempotent — duplicate vote does NOT double-count (Req 3.1, 3.2, 3.3)", async () => {
        authMock.mockResolvedValueOnce({
            user: {
                id: fixtures.customerId,
                customerId: fixtures.customerId,
                role: "customer",
            },
        });

        const res = await POST_HELPFUL(
            buildRequest(`/api/reviews/${seededReviewId}/helpful`, "POST", {}),
            { params: Promise.resolve({ id: seededReviewId }) }
        );
        const { status, json } = await readResponse<HelpfulBody>(res);

        expect(status).toBe(200);
        expect(json.alreadyVoted).toBe(true);
        // Counter UNCHANGED at the post-test-3 value of 1.
        expect(json.review.helpfulCount).toBe(1);

        // Storage assertions — these are the substantive duplicate-
        // protection checks. Either of them failing would imply the
        // unique constraint `uq_helpful_review_customer` is not
        // doing its job.
        const [{ n: voteCount }] = await db
            .select({ n: count() })
            .from(reviewHelpfulVotes)
            .where(
                and(
                    eq(reviewHelpfulVotes.reviewId, seededReviewId),
                    eq(reviewHelpfulVotes.customerId, fixtures.customerId)
                )
            );
        expect(voteCount).toBe(1);

        const [persisted] = await db
            .select({ helpfulCount: reviews.helpfulCount })
            .from(reviews)
            .where(eq(reviews.id, seededReviewId))
            .limit(1);
        expect(persisted?.helpfulCount).toBe(1);
    });
});
