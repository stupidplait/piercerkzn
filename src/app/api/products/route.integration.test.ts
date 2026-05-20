/**
 * Integration tests for `GET /api/products` — the public, paginated product
 * catalogue. Imports the route handler directly and calls it with synthetic
 * `Request` objects (no HTTP server), per the established admin-test
 * convention under `src/app/api/admin/**\/*.integration.test.ts`.
 *
 * Scope (Phase 3, task 3.1):
 *   1. Happy path                — seed 3 tagged products in a "rare"
 *                                  material the dev seed never uses, GET
 *                                  the catalogue, expect 200 + every
 *                                  seeded handle present (Req 3.1 / 3.2).
 *   2. Material filter           — seed 2 + 1 split across two rare
 *                                  materials, filter by the second one,
 *                                  assert only the matching tagged handle
 *                                  comes back (Req 3.2).
 *   3. limit pagination          — seed 3 tagged products in one rare
 *                                  material, request `limit=1` and
 *                                  `limit=2`, assert `count` matches the
 *                                  requested page size and `total` reports
 *                                  the full set size (Req 3.2).
 *   4. Invalid limit (negative)  — request `limit=-1`, assert 422 +
 *                                  `error.code: "validation_error"`
 *                                  (Req 3.4 / 3.5).
 *   5. Invalid limit (NaN)       — request `limit=abc`, assert 422 +
 *                                  `validation_error` (Req 3.4 / 3.5).
 *   6. Invalid offset            — request `offset=-1`, assert 422 +
 *                                  `validation_error` (Req 3.4 / 3.5).
 *   7. afterAll cleanup          — `cleanupTaggedRows(tag)` (Req 3.8).
 *
 * Cursor → offset deviation note (matching actual SUT, not the brief):
 *   The task brief refers to a `cursor` query param, but the live route at
 *   `app/src/app/api/products/route.ts` validates against
 *   `paginationSchema` from `@/lib/validations/common.ts`, which exposes
 *   numeric `limit` + `offset` (no `cursor` shape). I therefore exercise
 *   `offset=-1` for the cursor-style negative path; the assertion target
 *   (HTTP 422 + `error.code: "validation_error"`) is identical.
 *
 * 400 → 422 deviation note:
 *   The brief asks for "400/422 with `error.code: "validation_error"`".
 *   `parseQuery()` in `@/lib/api.ts` funnels Zod failures through
 *   `validationFailed()`, which always emits HTTP 422. I assert 422
 *   exactly (matches the SUT) rather than accepting either status.
 *
 * Mock surface
 * ---------------------------------------------------------------------------
 *
 *   `setup.ts` already mocks `@/lib/auth`, `@/lib/rate-limit`, and
 *   `@/lib/api` process-wide. The public products route uses
 *   `applyRateLimit` (no-op'd) + `parseQuery` + `ok` + `internal` from
 *   `@/lib/api`; `setup.ts`'s `vi.importActual` preserves `parseQuery` /
 *   `ok` / `internal` so validation behaviour is real. No file-local
 *   `vi.mock` calls are required.
 */
import { count } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "./route";
import { db, productVariants, products } from "@/db";
import {
    buildRequest,
    cleanupTaggedRows,
    expectRowCountUnchanged,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

// ---------------------------------------------------------------------------
// Test fixtures and constants
// ---------------------------------------------------------------------------

/**
 * "Rare" materials: present in the `materials` enum at
 * `@/lib/validations/product.ts` but NOT inserted by the dev seed at
 * `app/src/db/seed.ts` (which only seeds `titanium` + `gold_14k`).
 *
 * Picking a material the dev seed never uses lets the filter test assert
 * an exact equality on the tagged-handle set instead of a "contains"
 * subset check, because the rare-material slice of the catalogue is
 * exclusively rows this test seeded.
 */
const RARE_MATERIAL_A = "niobium";
const RARE_MATERIAL_B = "bioplast";

/** Tag shared by every test in this file — single cleanup at `afterAll`. */
const tag = makeTestTag("p3-prd");

interface ProductCard {
    id: string;
    handle: string;
    title: string;
    material: string;
    jewelryType: string;
    minPrice: number | null;
    inStock: boolean | null;
}

interface ListResponse {
    products: ProductCard[];
    count: number;
    total: number;
    limit: number;
    offset: number;
}

interface ErrorBody {
    error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Per-suite seeding helpers
// ---------------------------------------------------------------------------

/**
 * Row-count snapshot bookkeeping (per design §"Phase 3" → AC 3.8 / 2.12
 * pattern carried over from the reservation route file). The two tables
 * below are the entire surface this file's seeding touches:
 *
 *   - product            — explicit insert per `seedTaggedProduct`
 *   - product_variant    — one inserted per seeded product
 *
 * `cleanupTaggedRows(tag)` deletes products by `handle LIKE %tag%`;
 * variants cascade off `product.id` thanks to the `onDelete: "cascade"`
 * FK on `product_variant.product_id`. A clean run lands the counts back
 * at their pre-test values.
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

/**
 * Insert one tagged product + one tagged variant. Keeps the seed direct
 * (Drizzle-only, no SUT) so the test controls every column the route
 * filters on. Cleanup runs through `cleanupTaggedRows(tag)`, which
 * matches `product.handle LIKE %tag%`; variants cascade off product.id.
 */
async function seedTaggedProduct(
    suffix: string,
    opts: {
        material: string;
        jewelryType?: string;
        inventoryQty?: number;
    }
): Promise<{ id: string; handle: string }> {
    const handle = `${tag}-${suffix}`;
    const [created] = await db
        .insert(products)
        .values({
            handle,
            title: `Тест ${handle}`,
            material: opts.material,
            jewelryType: opts.jewelryType ?? "stud",
            status: "published",
            publishedAt: new Date(),
        })
        .returning({ id: products.id, handle: products.handle });

    await db.insert(productVariants).values({
        productId: created.id,
        title: `${tag}-variant-${suffix}`,
        sku: `${tag}-sku-${suffix}`,
        priceRub: 250_000,
        manageInventory: true,
        inventoryQuantity: opts.inventoryQty ?? 5,
        allowBackorder: false,
    });

    return created;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GET /api/products integration", () => {
    /**
     * Seeded once for the whole suite:
     *   - 3 products in `RARE_MATERIAL_A` (niobium): a / b / c
     *   - 1 product in `RARE_MATERIAL_B` (bioplast): d
     *
     * The split lets the same fixture set drive the happy path (all 4),
     * the material filter (3 vs. 1), and the limit pagination tests
     * (3 in `RARE_MATERIAL_A`).
     *
     * The dev seed at `src/db/seed.ts` never inserts niobium or bioplast,
     * so the rare-material slice of the catalogue is exclusively this
     * suite's rows — `material=…` filters can be asserted with strict
     * equality on handles instead of subset containment.
     */
    let handleA1 = "";
    let handleA2 = "";
    let handleA3 = "";
    let handleB1 = "";
    let snapshotBefore: RowCounts;

    beforeAll(async () => {
        // Snapshot row counts BEFORE seeding so the `afterAll` assertion
        // observes the pre-test state — `cleanupTaggedRows(tag)` should
        // restore exactly this baseline (Req 3.8 row-count parity).
        snapshotBefore = await snapshotRowCounts();

        const a1 = await seedTaggedProduct("a1", { material: RARE_MATERIAL_A });
        const a2 = await seedTaggedProduct("a2", { material: RARE_MATERIAL_A });
        const a3 = await seedTaggedProduct("a3", { material: RARE_MATERIAL_A });
        const b1 = await seedTaggedProduct("b1", { material: RARE_MATERIAL_B });
        handleA1 = a1.handle;
        handleA2 = a2.handle;
        handleA3 = a3.handle;
        handleB1 = b1.handle;
    });

    afterAll(async () => {
        // Idempotent — `cleanupTaggedRows(tag)` deletes by `handle LIKE %tag%`,
        // and variant rows cascade off `product.id`.
        await cleanupTaggedRows(tag);
        const snapshotAfter = await snapshotRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    // -------------------------------------------------------------------
    // Happy path (Req 3.1, 3.2)
    // -------------------------------------------------------------------
    //
    // The dev DB carries existing published products, so we cannot assert
    // an exact handle-set equality on the unfiltered catalogue. Instead
    // we assert HTTP 200 + the response shape + that every seeded handle
    // is present somewhere in the paged window (limit=100 covers the
    // current dev seed plus our 4 rows).
    it("returns 200 with a products array and includes seeded handles (Req 3.1)", async () => {
        const res = await GET(buildRequest("/api/products", "GET", { query: { limit: 100 } }));
        const { status, json } = await readResponse<ListResponse>(res);

        expect(status).toBe(200);
        expect(Array.isArray(json.products)).toBe(true);
        expect(json.limit).toBe(100);
        expect(json.offset).toBe(0);
        expect(json.count).toBe(json.products.length);

        const handles = new Set(json.products.map((p) => p.handle));
        expect(handles.has(handleA1)).toBe(true);
        expect(handles.has(handleA2)).toBe(true);
        expect(handles.has(handleA3)).toBe(true);
        expect(handles.has(handleB1)).toBe(true);
    });

    // -------------------------------------------------------------------
    // Material filter (Req 3.2)
    // -------------------------------------------------------------------
    //
    // `material=bioplast` narrows the catalogue to rows the dev seed
    // never inserts, so the tagged `b1` handle is the only legitimate
    // result and the assertion can be a strict equality on the handle
    // set. Likewise `material=niobium` pins the result to a1/a2/a3.
    it("filters by material — only tagged rows in that material come back (Req 3.2)", async () => {
        const res = await GET(
            buildRequest("/api/products", "GET", {
                query: { material: RARE_MATERIAL_B, limit: 100 },
            })
        );
        const { status, json } = await readResponse<ListResponse>(res);

        expect(status).toBe(200);
        expect(json.products.every((p) => p.material === RARE_MATERIAL_B)).toBe(true);
        const handles = json.products.map((p) => p.handle).sort();
        expect(handles).toEqual([handleB1].sort());
        expect(json.total).toBe(1);
    });

    // -------------------------------------------------------------------
    // limit pagination — limit=1 (Req 3.2)
    // -------------------------------------------------------------------
    //
    // The 3 tagged niobium rows form the entire `material=niobium` slice
    // (dev seed never inserts niobium), so the route's `total` field is
    // the exact size of our seeded set. `limit=1` must return the first
    // page only, with `count === 1` and `total === 3`.
    it("honours limit=1 — returns 1 product with total=3 across the niobium slice (Req 3.2)", async () => {
        const res = await GET(
            buildRequest("/api/products", "GET", {
                query: { material: RARE_MATERIAL_A, limit: 1, offset: 0 },
            })
        );
        const { status, json } = await readResponse<ListResponse>(res);

        expect(status).toBe(200);
        expect(json.limit).toBe(1);
        expect(json.offset).toBe(0);
        expect(json.products).toHaveLength(1);
        expect(json.count).toBe(1);
        expect(json.total).toBe(3);
        expect(json.products[0].material).toBe(RARE_MATERIAL_A);
    });

    // -------------------------------------------------------------------
    // limit pagination — limit=2 (Req 3.2)
    // -------------------------------------------------------------------
    //
    // Same niobium slice as the limit=1 case; bumping limit to 2 must
    // return the first two niobium rows with `count === 2`, `total === 3`.
    it("honours limit=2 — returns 2 products with total=3 across the niobium slice (Req 3.2)", async () => {
        const res = await GET(
            buildRequest("/api/products", "GET", {
                query: { material: RARE_MATERIAL_A, limit: 2, offset: 0 },
            })
        );
        const { status, json } = await readResponse<ListResponse>(res);

        expect(status).toBe(200);
        expect(json.limit).toBe(2);
        expect(json.products).toHaveLength(2);
        expect(json.count).toBe(2);
        expect(json.total).toBe(3);
        expect(json.products.every((p) => p.material === RARE_MATERIAL_A)).toBe(true);
    });

    // -------------------------------------------------------------------
    // Invalid limit — negative (Req 3.4, 3.5)
    // -------------------------------------------------------------------
    //
    // `paginationSchema.limit` is `z.coerce.number().int().min(1).max(100)`.
    // `-1` coerces to `-1`, fails `min(1)`, and `parseQuery` funnels the
    // ZodError through `validationFailed()` → HTTP 422 +
    // `error.code: "validation_error"` (the lowercase `ErrorCode.Validation`
    // constant from `@/lib/api`).
    it("rejects limit=-1 with 422 + validation_error (Req 3.4, 3.5)", async () => {
        const res = await GET(buildRequest("/api/products", "GET", { query: { limit: -1 } }));
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(422);
        expect(json.error.code).toBe("validation_error");
    });

    // -------------------------------------------------------------------
    // Invalid limit — non-numeric (Req 3.4, 3.5)
    // -------------------------------------------------------------------
    //
    // `z.coerce.number()` on `"abc"` produces `NaN`, which fails `int()`
    // immediately. Same `validationFailed()` envelope as the negative
    // case above.
    it("rejects limit=abc with 422 + validation_error (Req 3.4, 3.5)", async () => {
        const res = await GET(buildRequest("/api/products", "GET", { query: { limit: "abc" } }));
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(422);
        expect(json.error.code).toBe("validation_error");
    });

    // -------------------------------------------------------------------
    // Invalid offset (Req 3.4, 3.5)
    // -------------------------------------------------------------------
    //
    // The brief refers to a "cursor" param, but the live SUT validates
    // against `paginationSchema` which exposes `offset: z.coerce.number()
    // .int().min(0)`, no `cursor` shape. `offset=-1` is the cursor-style
    // analogue — fails `min(0)` and yields the same 422 +
    // `validation_error` envelope as the limit cases above. The brief's
    // 400/422 phrasing accommodates this; I assert the actual SUT status
    // (422).
    it("rejects offset=-1 with 422 + validation_error (Req 3.4, 3.5)", async () => {
        const res = await GET(buildRequest("/api/products", "GET", { query: { offset: -1 } }));
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(422);
        expect(json.error.code).toBe("validation_error");
    });
});
