/**
 * Integration tests for the public wishlist surface:
 *
 *   POST   /api/wishlist                — add a product (customer-scoped)
 *   GET    /api/wishlist                — list current customer's wishlist
 *   DELETE /api/wishlist/[productId]    — remove a product (idempotent)
 *   GET    /api/wishlist/share/[token]  — public read-only shared view
 *
 * Imports the route handlers directly and calls them with synthetic
 * `Request` objects (no HTTP server), per the established convention
 * under `src/app/api/admin/**\/*.integration.test.ts` and the sibling
 * Phase 3 tests (`products`, `looks`, `unsubscribe`, `contact`).
 *
 * Scope (Phase 3, task 3.6):
 *   1. POST /api/wishlist add — auth mocked, expect 201 + the inserted
 *      `wishlist_item` reachable in storage (Req 3.1, 3.2, 3.3).
 *   2. GET /api/wishlist list — auth mocked, expect 200 + the previously
 *      added product handle present in `items[]` and a non-empty
 *      `shareToken` (Req 3.1, 3.2, 3.3).
 *   3. DELETE /api/wishlist/[productId] remove — auth mocked, expect 204
 *      and verify the row is gone from storage (Req 3.1, 3.2, 3.3).
 *   4. POST unauthenticated → 401 — no auth override (`setup.ts` default
 *      returns null), expect 401 + `error.code: "unauthorized"`
 *      (Req 3.4, 3.5).
 *   5. Share-token round-trip — mint a token via `buildWishlistShareToken`,
 *      hit `GET /api/wishlist/share/[token]`, assert the route resolves
 *      to the customer's wishlist; a tampered token returns 404
 *      (Req 3.6, 3.8).
 *
 * Cleanup strategy
 * ---------------------------------------------------------------------------
 * Wishlist items cascade off `customer.id` (`onDelete: "cascade"` on
 * `wishlist_item.customer_id`), so deleting the tagged customer in
 * `afterAll` is sufficient to remove every `wishlist_item` row this
 * suite created. The product is deleted via `cleanupTaggedRows(tag)`.
 *
 * The generic `cleanupTaggedRows(tag)` does NOT cover `customer` rows
 * (it focuses on the catalog / content / contact surfaces), so this
 * file owns its own customer cleanup — same shape as the snapshot-
 * restore pattern in `src/app/api/unsubscribe/route.integration.test.ts`.
 *
 * Mock surface
 * ---------------------------------------------------------------------------
 *   `setup.ts` mocks `@/lib/auth` with `auth: vi.fn(async () => null)`
 *   process-wide. Customer-scoped tests flip the mock per-test via
 *   `authMock.mockResolvedValueOnce({ user: { ... } })`. The
 *   `afterEach` hook resets the mock back to its default no-session
 *   state so a leaked `mockResolvedValueOnce` cannot cross test
 *   boundaries.
 */
import { and, count, eq, like } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { POST as POST_WISHLIST, GET as GET_WISHLIST } from "./route";
import { DELETE as DELETE_WISHLIST_ITEM } from "./[productId]/route";
import { GET as GET_SHARED } from "./share/[token]/route";
import { customers, db, products, wishlistItems } from "@/db";
import { auth } from "@/lib/auth";
import { buildWishlistShareToken } from "@/lib/wishlist";
import {
    buildRequest,
    cleanupTaggedRows,
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
// `src/app/api/customers/me/route.integration.test.ts`.
const authMock = vi.mocked(
    auth as unknown as () => Promise<{
        user: { id: string; customerId?: string; role?: "customer" | "admin" | "staff" };
    } | null>
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const tag = makeTestTag("p3-wish");

interface ErrorBody {
    error: { code: string; message: string; details?: unknown };
}

interface AddItemResponse {
    item: { id: string; productId: string; addedAt: string };
    wasAlreadyPresent: boolean;
}

interface WishlistItemRow {
    productId: string;
    handle: string;
    title: string;
    minPrice: number | null;
}

interface ListResponse {
    items: WishlistItemRow[];
    count: number;
    shareToken: string;
}

interface ShareResponse {
    owner: { name: string };
    items: WishlistItemRow[];
    count: number;
}

// ---------------------------------------------------------------------------
// Row-count snapshot bookkeeping (Req 3.8)
// ---------------------------------------------------------------------------
//
// Mirrors the pattern from `src/app/api/customers/me/route.integration.test.ts`:
// the `customer` and `wishlist_item` tables are shared with the dev
// environment (OAuth sign-ins, customer self-service, …) and other
// integration test files that may run alongside. A bare
// `count() FROM customer` snapshot would diverge under concurrent dev /
// test activity even when this suite's cleanup is perfect.
//
// Instead the snapshot below counts ONLY rows this suite owns — those
// whose tagged columns match the suite-wide tag prefix:
//
//   - customer        — by `email LIKE %tag%`
//   - product         — by `handle LIKE %tag%`
//   - wishlist_item   — by joining through the seeded customer id (the
//                       only customer that can reach this row given
//                       the FK + unique constraint on customer/product)
//
// Before any test runs, all three tagged counts are `0`; after
// `afterAll` deletes the seeded customer and product, all three must be
// `0` again. Net-zero on the rows this suite owns is the invariant
// Req 3.8 actually asks for — external mutations on other rows are not
// part of "this test's mutations". `expectRowCountUnchanged` still does
// the diff for us.
type RowCounts = Record<string, number>;

async function snapshotTaggedRowCounts(): Promise<RowCounts> {
    const [[customerCount], [productCount], [wishlistCount]] = await Promise.all([
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
            .from(wishlistItems)
            .innerJoin(customers, eq(customers.id, wishlistItems.customerId))
            .where(like(customers.email, `%${tag}%`)),
    ]);
    return {
        tagged_customer: customerCount.n,
        tagged_product: productCount.n,
        tagged_wishlist_item: wishlistCount.n,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("/api/wishlist integration", () => {
    let customerId = "";
    let customerEmail = "";
    let productId = "";
    let productHandle = "";
    let snapshotBefore: RowCounts;

    beforeAll(async () => {
        // Snapshot first so the seeded customer + product are tracked as
        // +1/+1; afterAll cleanup must restore the baseline exactly.
        snapshotBefore = await snapshotTaggedRowCounts();

        // Seed a tagged customer. Wishlist items cascade off this row.
        customerEmail = `${tag}@test.local`;
        const [seededCustomer] = await db
            .insert(customers)
            .values({
                email: customerEmail,
                firstName: "Test",
                lastName: tag,
            })
            .returning({ id: customers.id, email: customers.email });
        customerId = seededCustomer.id;

        // Seed a tagged published product so the `POST /api/wishlist`
        // route's status guard passes (it rejects draft/archived rows
        // with a 404). `cleanupTaggedRows` deletes by handle LIKE %tag%.
        productHandle = `${tag}-prod`;
        const [seededProduct] = await db
            .insert(products)
            .values({
                handle: productHandle,
                title: `Тест ${productHandle}`,
                material: "titanium",
                jewelryType: "stud",
                status: "published",
                publishedAt: new Date(),
            })
            .returning({ id: products.id, handle: products.handle });
        productId = seededProduct.id;
    });

    afterAll(async () => {
        // Wishlist items cascade off the customer (onDelete: "cascade"
        // on wishlist_item.customer_id), so deleting the tagged customer
        // is sufficient. The generic cleanupTaggedRows does NOT cover
        // customer rows — same caveat as in the unsubscribe integration
        // test — so we own the customer cleanup here.
        //
        // Use an exact-email predicate (not `LIKE %tag%`) so the cleanup
        // is robust to any pre-existing customer rows whose email
        // happens to share a substring with the tag prefix. The seed
        // path inserts exactly one customer at `customerEmail`, so an
        // equality predicate is both sufficient and deterministic.
        await db.delete(customers).where(eq(customers.email, customerEmail));
        // Product cleanup goes through the shared helper, which already
        // deletes by handle LIKE %tag%.
        await cleanupTaggedRows(tag);

        const snapshotAfter = await snapshotTaggedRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    afterEach(() => {
        // Reset the auth mock back to the setup.ts default (no session)
        // so a leaked `mockResolvedValueOnce` cannot cross test
        // boundaries. `mockReset()` strips overrides; we then re-assert
        // the setup.ts no-session default explicitly so unauthenticated
        // tests never see a stale resolved value from a prior test.
        authMock.mockReset();
        authMock.mockResolvedValue(null);
    });

    // -------------------------------------------------------------------
    // 1. POST /api/wishlist — add a product (Req 3.1, 3.2, 3.3)
    // -------------------------------------------------------------------
    //
    // Forge the auth context for one call: the route reads
    // `session.user.customerId` via `requireUser` → `getOptionalUser`
    // and writes `wishlist_item.customer_id`. Asserts HTTP 201 (first
    // insert) and the inserted row is reachable in storage.
    it("POST adds a product to the wishlist with 201 + reachable row (Req 3.1, 3.2, 3.3)", async () => {
        authMock.mockResolvedValueOnce({
            user: { id: customerId, customerId, role: "customer" },
        });

        const res = await POST_WISHLIST(
            buildRequest("/api/wishlist", "POST", { body: { productId } })
        );
        const { status, json } = await readResponse<AddItemResponse>(res);

        expect(status).toBe(201);
        expect(json.wasAlreadyPresent).toBe(false);
        expect(json.item.productId).toBe(productId);

        // Verify the row is reachable in storage by the customer +
        // product PK pair (the SUT's idempotence is enforced by the
        // `uq_wishlist_customer_product` unique constraint).
        const [stored] = await db
            .select({ id: wishlistItems.id })
            .from(wishlistItems)
            .where(
                and(
                    eq(wishlistItems.customerId, customerId),
                    eq(wishlistItems.productId, productId)
                )
            )
            .limit(1);
        expect(stored?.id).toBe(json.item.id);
    });

    // -------------------------------------------------------------------
    // 2. GET /api/wishlist — list (Req 3.1, 3.2, 3.3)
    // -------------------------------------------------------------------
    //
    // The previous test inserted exactly one wishlist_item for this
    // customer. The GET route filters by `customer.id`, so a strict
    // equality assertion on the result handle list is safe even on a
    // dev DB seeded with other customers.
    it("GET lists the customer's wishlist with 200 + share token (Req 3.1, 3.2, 3.3)", async () => {
        authMock.mockResolvedValueOnce({
            user: { id: customerId, customerId, role: "customer" },
        });

        const res = await GET_WISHLIST();
        const { status, json } = await readResponse<ListResponse>(res);

        expect(status).toBe(200);
        expect(json.count).toBe(1);
        expect(json.items.map((i) => i.handle)).toEqual([productHandle]);
        // The share token is a deterministic HMAC over the customer id
        // (see `@/lib/wishlist`); the route MUST surface it on every GET
        // so the customer can copy a shareable URL from the UI.
        expect(json.shareToken).toBe(buildWishlistShareToken(customerId));
    });

    // -------------------------------------------------------------------
    // 3. DELETE /api/wishlist/[productId] — remove (Req 3.1, 3.2, 3.3)
    // -------------------------------------------------------------------
    //
    // The route's contract: 204 on success AND idempotent (a repeated
    // call returns 204 even when no row matched). We verify the first
    // delete by reading the storage row count for this customer +
    // product pair after the call.
    it("DELETE removes a product from the wishlist with 204 (Req 3.1, 3.2, 3.3)", async () => {
        authMock.mockResolvedValueOnce({
            user: { id: customerId, customerId, role: "customer" },
        });

        const res = await DELETE_WISHLIST_ITEM(
            buildRequest(`/api/wishlist/${productId}`, "DELETE"),
            { params: Promise.resolve({ productId }) }
        );

        // Route returns `noContent()` → HTTP 204 with an empty body. We
        // only assert the status here because `readResponse` parses
        // JSON; 204 has none.
        expect(res.status).toBe(204);

        // Verify the row is gone from storage.
        const [{ n }] = await db
            .select({ n: count() })
            .from(wishlistItems)
            .where(
                and(
                    eq(wishlistItems.customerId, customerId),
                    eq(wishlistItems.productId, productId)
                )
            );
        expect(n).toBe(0);
    });

    // -------------------------------------------------------------------
    // 4. POST unauthenticated → 401 (Req 3.4, 3.5)
    // -------------------------------------------------------------------
    //
    // No `mockResolvedValueOnce` override here — the `afterEach` hook
    // restored the setup.ts default (`auth() → null`), which makes
    // `requireUser` short-circuit through `unauthorized()` →
    // HTTP 401 + `error.code: "unauthorized"`.
    it("POST without a session returns 401 + unauthorized (Req 3.4, 3.5)", async () => {
        const res = await POST_WISHLIST(
            buildRequest("/api/wishlist", "POST", { body: { productId } })
        );
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(401);
        expect(json.error.code).toBe("unauthorized");
    });

    // -------------------------------------------------------------------
    // 5. Share-token round-trip (Req 3.6, 3.8)
    // -------------------------------------------------------------------
    //
    // The shared view is public — the route does NOT call `requireUser`,
    // so no auth override is needed. We mint a token via the SUT helper
    // (`buildWishlistShareToken`), hit the route, and assert it
    // resolves to the customer's wishlist. We then re-add the product
    // (the previous DELETE test cleared it) so there's at least one item
    // in the shared response.
    //
    // A second case asserts that a tampered token returns 404 — the
    // public route MUST NOT leak any signal about whether the customer
    // exists for an invalid token (`verifyWishlistShareToken` returns
    // null and the route emits `notFound()`).
    it("share-token round-trip: token mints → route resolves to the wishlist (Req 3.6, 3.8)", async () => {
        // Re-add the product so the shared response has something to
        // surface. Bypass the SUT — the previous test exercised the
        // POST handler already; here we want a deterministic seed.
        await db.insert(wishlistItems).values({
            customerId,
            productId,
        });

        const token = buildWishlistShareToken(customerId);
        const res = await GET_SHARED(buildRequest(`/api/wishlist/share/${token}`, "GET"), {
            params: Promise.resolve({ token }),
        });
        const { status, json } = await readResponse<ShareResponse>(res);

        expect(status).toBe(200);
        expect(json.count).toBe(1);
        expect(json.items.map((i) => i.handle)).toEqual([productHandle]);
        // Owner label is composed from `customer.firstName` + first
        // initial of `customer.lastName` per the route's compose logic.
        // The seeded customer has `firstName: "Test"`, `lastName: tag`,
        // so the label is `Test ${tag[0]}.` — assert containment to
        // tolerate non-deterministic tag prefixes.
        expect(json.owner.name).toContain("Test");
    });

    it("share-token round-trip: tampered token returns 404 (Req 3.6, 3.8)", async () => {
        const valid = buildWishlistShareToken(customerId);
        const [head, sig] = valid.split(".");
        // Flip a single hex character in the HMAC suffix so
        // `timingSafeEqual` rejects the token. Same shape as the
        // tamper case in the unsubscribe integration test.
        const tampered = `${head}.${sig.startsWith("a") ? "b" : "a"}${sig.slice(1)}`;

        const res = await GET_SHARED(buildRequest(`/api/wishlist/share/${tampered}`, "GET"), {
            params: Promise.resolve({ token: tampered }),
        });
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(404);
        expect(json.error.code).toBe("not_found");
    });
});
