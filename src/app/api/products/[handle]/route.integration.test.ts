/**
 * Integration tests for `GET /api/products/[handle]` — the public PDP
 * (Product Detail Page) endpoint. Imports the route handler directly and
 * calls it with synthetic `Request` objects (no HTTP server), per the
 * established convention under `src/app/api/**\/*.integration.test.ts`.
 *
 * Scope (Phase 3, task 3.2):
 *   1. Happy path        — seed a tagged published product in a "rare"
 *                          material the dev seed never uses, GET
 *                          `/api/products/${handle}`, expect 200 + a
 *                          product body whose `handle` matches what we
 *                          seeded (Req 3.1 / 3.2).
 *   2. Not found         — GET with a handle no row carries, expect
 *                          404 + `error.code: "not_found"` (Req 3.4 /
 *                          3.8).
 *   3. Soft-deleted excluded
 *                        — seed a product with `deletedAt: new Date()`
 *                          AND `status: "published"` (so only the
 *                          soft-delete predicate excludes it), GET, and
 *                          assert 404 — the route's WHERE clause
 *                          explicitly contains `isNull(products.deletedAt)`
 *                          (Req 3.4 / 3.8).
 *
 * Next 15+ dynamic-route signature note
 * ---------------------------------------------------------------------------
 *
 *   The PDP handler is `GET(_req, ctx: { params: Promise<{ handle: string }> })`,
 *   matching the Next 15+ async-params convention. Tests pass
 *   `params: Promise.resolve({ handle })` as the second argument so the
 *   handler's `await ctx.params` resolves immediately.
 *
 * Mock surface
 * ---------------------------------------------------------------------------
 *
 *   `setup.ts` already mocks `@/lib/auth`, `@/lib/rate-limit`, and
 *   `@/lib/api` process-wide. The PDP route only uses `db`, `notFound`,
 *   `internal`, and `ok` — `setup.ts`'s `vi.importActual` preserves the
 *   real implementations of those response helpers, so no file-local
 *   `vi.mock` calls are required.
 */
import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "./route";
import { db, productVariants, products } from "@/db";
import {
    cleanupTaggedRows,
    expectRowCountUnchanged,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

// ---------------------------------------------------------------------------
// Test fixtures and constants
// ---------------------------------------------------------------------------

/**
 * "Rare" material: present in the `materials` enum at
 * `@/lib/validations/product.ts` but NOT inserted by the dev seed at
 * `app/src/db/seed.ts` (which only seeds `titanium` + `gold_14k`).
 *
 * Picking a material the dev seed never uses keeps the seeded handles
 * collision-free against the live dev catalogue.
 */
const RARE_MATERIAL = "niobium";

/** Tag shared by every test in this file — single cleanup at `afterAll`. */
const tag = makeTestTag("p3-pdp");

interface PdpProduct {
    id: string;
    handle: string;
    title: string;
    description: string | null;
    material: string;
    jewelryType: string;
    variants: Array<{ id: string; sku: string | null; inStock: boolean }>;
    piercingAreas: string[];
    media: Array<{ id: string; url: string }>;
}

interface PdpResponse {
    product: PdpProduct;
}

interface ErrorBody {
    error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Per-suite seeding helpers
// ---------------------------------------------------------------------------

/**
 * Row-count snapshot bookkeeping (per design §"Phase 3" → AC 3.8 / 2.12
 * pattern carried over from the catalogue route file `route.integration
 * .test.ts`). Two tables are touched by this file's seeding:
 *
 *   - product            — explicit insert per `seedTaggedProduct`
 *   - product_variant    — one inserted alongside the happy-path product
 *
 * `cleanupTaggedRows(tag)` deletes products by `handle LIKE %tag%`;
 * variants cascade off `product.id` thanks to the `onDelete: "cascade"`
 * FK on `product_variant.product_id`. A clean run lands the counts back
 * at their pre-test values, even for the soft-deleted row (which still
 * matches `handle LIKE %tag%`).
 */
type RowCounts = Record<string, number>;

async function snapshotRowCounts(): Promise<RowCounts> {
    const [[productCount], [variantCount]] = await Promise.all([
        db.select({ n: count() }).from(products),
        db.select({ n: count() }).from(productVariants),
    ]);
    return {
        product: productCount.n,
        product_variant: variantCount.n,
    };
}

interface SeedOpts {
    /** When set, the row is inserted with this `deleted_at` value. */
    deletedAt?: Date;
    /** Whether to attach a single tagged variant. Default `true`. */
    withVariant?: boolean;
    /** Status override; defaults to `"published"`. */
    status?: "draft" | "published" | "archived";
}

/**
 * Insert one tagged product (and optionally one tagged variant) directly
 * via Drizzle. Keeps the seed deterministic so the test controls every
 * column the route's WHERE clause reads (`status`, `deletedAt`, `handle`).
 */
async function seedTaggedProduct(
    suffix: string,
    opts: SeedOpts = {}
): Promise<{ id: string; handle: string }> {
    const handle = `${tag}-${suffix}`;
    const [created] = await db
        .insert(products)
        .values({
            handle,
            title: `Тест ${handle}`,
            description: `Описание ${handle}`,
            material: RARE_MATERIAL,
            jewelryType: "stud",
            status: opts.status ?? "published",
            publishedAt: new Date(),
            deletedAt: opts.deletedAt,
        })
        .returning({ id: products.id, handle: products.handle });

    if (opts.withVariant !== false) {
        await db.insert(productVariants).values({
            productId: created.id,
            title: `${tag}-variant-${suffix}`,
            sku: `${tag}-sku-${suffix}`,
            priceRub: 250_000,
            manageInventory: true,
            inventoryQuantity: 5,
            allowBackorder: false,
        });
    }

    return created;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GET /api/products/[handle] integration", () => {
    /**
     * Seeded once for the whole suite:
     *   - `live` — published product in `RARE_MATERIAL`, with one variant
     *     (drives the happy-path test).
     *   - `gone` — published product in `RARE_MATERIAL`, with
     *     `deletedAt: new Date()` (drives the soft-delete exclusion test).
     */
    let liveHandle = "";
    let goneHandle = "";
    let snapshotBefore: RowCounts;

    beforeAll(async () => {
        // Snapshot row counts BEFORE seeding so the `afterAll` assertion
        // observes the pre-test state — `cleanupTaggedRows(tag)` should
        // restore exactly this baseline (Req 3.8 row-count parity).
        snapshotBefore = await snapshotRowCounts();

        const live = await seedTaggedProduct("live", {});
        const gone = await seedTaggedProduct("gone", {
            deletedAt: new Date(),
            withVariant: false,
        });
        liveHandle = live.handle;
        goneHandle = gone.handle;
    });

    afterAll(async () => {
        // `cleanupTaggedRows(tag)` deletes by `handle LIKE %tag%`; both
        // the live and soft-deleted products match the predicate, and
        // variant rows cascade off `product.id`.
        await cleanupTaggedRows(tag);
        const snapshotAfter = await snapshotRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    // -------------------------------------------------------------------
    // Happy path (Req 3.1, 3.2)
    // -------------------------------------------------------------------
    //
    // Resolves the tagged published product. The route returns the full
    // product card shape under `{ product }`, including `variants`,
    // `piercingAreas`, and `media` arrays — none of which we need to
    // assert exhaustively, so we sanity-check shape + identity only.
    it("returns 200 + product body for a published handle (Req 3.1)", async () => {
        const res = await GET(new Request(`http://test.local/api/products/${liveHandle}`), {
            params: Promise.resolve({ handle: liveHandle }),
        });
        const { status, json } = await readResponse<PdpResponse>(res);

        expect(status).toBe(200);
        expect(json.product).toBeDefined();
        expect(json.product.handle).toBe(liveHandle);
        expect(json.product.material).toBe(RARE_MATERIAL);
        expect(Array.isArray(json.product.variants)).toBe(true);
        expect(json.product.variants).toHaveLength(1);
        expect(json.product.variants[0].sku).toBe(`${tag}-sku-live`);
        expect(json.product.variants[0].inStock).toBe(true);
        expect(Array.isArray(json.product.piercingAreas)).toBe(true);
        expect(Array.isArray(json.product.media)).toBe(true);
    });

    // -------------------------------------------------------------------
    // Not found (Req 3.4, 3.8)
    // -------------------------------------------------------------------
    //
    // No row with this handle exists in the test DB or the dev seed
    // (the tag prefix guarantees uniqueness). The handler's
    // `notFound("Украшение не найдено")` envelope returns 404 +
    // `error.code: "not_found"`.
    it("returns 404 + not_found for an unknown handle (Req 3.4)", async () => {
        const missing = `${tag}-does-not-exist`;
        const res = await GET(new Request(`http://test.local/api/products/${missing}`), {
            params: Promise.resolve({ handle: missing }),
        });
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(404);
        expect(json.error.code).toBe("not_found");
    });

    // -------------------------------------------------------------------
    // Soft-deleted excluded (Req 3.4, 3.8)
    // -------------------------------------------------------------------
    //
    // The `gone` product was seeded with `status: "published"` AND
    // `deletedAt: new Date()`, so the only WHERE-clause predicate that
    // can hide it is the route's `isNull(products.deletedAt)`. Asserting
    // 404 here therefore proves the soft-delete filter is wired up,
    // unambiguous of the published-status filter.
    it("returns 404 for a soft-deleted product (Req 3.4)", async () => {
        const res = await GET(new Request(`http://test.local/api/products/${goneHandle}`), {
            params: Promise.resolve({ handle: goneHandle }),
        });
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(404);
        expect(json.error.code).toBe("not_found");
    });
});
