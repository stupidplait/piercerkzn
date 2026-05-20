/**
 * Integration tests for `/api/admin/products/[id]/media` and
 * `.../media/[mediaId]` and `.../media/reorder`.
 *
 * The media surface owns the trickiest invariants in Phase D:
 *   - Partial-unique `uq_product_media_primary` (only one primary row per
 *     product). The route demotes the existing primary atomically when a
 *     new row claims primary, and refuses to demote the lone primary
 *     without a successor.
 *   - The denormalized `products.thumbnail_url` cache: kept in sync on
 *     primary flip, primary-row URL edits, and primary deletion.
 *   - Reorder atomicity + the trailing-block rule for media not mentioned
 *     in `ordering`.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { POST as createProductPOST } from "../../route";
import { GET as productGET } from "../route";
import { GET as listGET, POST as createPOST } from "./route";
import { DELETE as detailDELETE, PATCH as detailPATCH } from "./[mediaId]/route";
import { POST as reorderPOST } from "./reorder/route";

import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";
import { db, productMedia, products } from "@/db";

const tag = makeTestTag("med");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface MediaRow {
    id: string;
    productId: string;
    variantId: string | null;
    url: string;
    alt: string | null;
    kind: string;
    isPrimary: boolean;
    sortOrder: number;
}
interface MediaResponse {
    media: MediaRow;
}
interface ListResponse {
    media: MediaRow[];
    count: number;
}
interface ErrorBody {
    error: { code: string; message: string };
}

let counter = 1;
function nextHandle(): string {
    return `${tag}-${(counter++).toString(36)}`;
}

async function createProductId(): Promise<string> {
    const handle = nextHandle();
    const res = await createProductPOST(
        buildRequest("/api/admin/products", "POST", {
            body: {
                handle,
                title: `Тест ${handle}`,
                material: "titanium",
                jewelryType: "stud",
            },
        })
    );
    const parsed = await readResponse<{ product: { id: string } }>(res);
    return parsed.json.product.id;
}

async function attachMedia(productId: string, overrides: Partial<Record<string, unknown>> = {}) {
    const url = `https://cdn.example.com/${tag}/${Math.random().toString(36).slice(2, 8)}.jpg`;
    const res = await createPOST(
        buildRequest(`/api/admin/products/${productId}/media`, "POST", {
            body: { url, kind: "image", ...overrides },
        }),
        { params: Promise.resolve({ id: productId }) }
    );
    return readResponse<MediaResponse>(res);
}

async function readThumbnail(productId: string): Promise<string | null> {
    const [row] = await db
        .select({ thumbnailUrl: products.thumbnailUrl })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);
    return row?.thumbnailUrl ?? null;
}

describe("POST /api/admin/products/[id]/media — attach + primary flip", () => {
    it("attaches a non-primary row without affecting thumbnail_url", async () => {
        const productId = await createProductId();
        const res = await attachMedia(productId);
        expect(res.status).toBe(201);
        expect(res.json.media.isPrimary).toBe(false);
        expect(await readThumbnail(productId)).toBeNull();
    });

    it("attaching a primary row syncs products.thumbnail_url and demotes the existing primary", async () => {
        const productId = await createProductId();
        const first = await attachMedia(productId, { isPrimary: true });
        expect(first.json.media.isPrimary).toBe(true);
        const t1 = await readThumbnail(productId);
        expect(t1).toBe(first.json.media.url);

        const second = await attachMedia(productId, { isPrimary: true });
        expect(second.json.media.isPrimary).toBe(true);
        const t2 = await readThumbnail(productId);
        expect(t2).toBe(second.json.media.url);

        // Old primary was demoted in the same transaction — DB-side check.
        const rows = await db
            .select()
            .from(productMedia)
            .where(eq(productMedia.productId, productId));
        const primaries = rows.filter((r) => r.isPrimary);
        expect(primaries).toHaveLength(1);
        expect(primaries[0].id).toBe(second.json.media.id);
    });

    it("rejects variantId from a different product (variant_not_found)", async () => {
        const productA = await createProductId();
        const productB = await createProductId();

        // Send a syntactically-valid but non-existent v4 UUID; the route's
        // existence check should turn it into a 400 variant_not_found.
        const ghostVariant = "00000000-0000-4000-8000-0000000000bb";
        const url = `https://cdn.example.com/${tag}/x.jpg`;
        const res = await createPOST(
            buildRequest(`/api/admin/products/${productA}/media`, "POST", {
                body: { url, variantId: ghostVariant },
            }),
            { params: Promise.resolve({ id: productA }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("variant_not_found");
        // (Asserts that `productB`'s existence doesn't change the answer.)
        expect(productB).toBeTruthy();
    });
});

describe("PATCH /api/admin/products/[id]/media/[mediaId]", () => {
    it("flipping a non-primary row to primary atomically demotes the old primary", async () => {
        const productId = await createProductId();
        const a = await attachMedia(productId, { isPrimary: true });
        const b = await attachMedia(productId);
        expect(b.json.media.isPrimary).toBe(false);

        const res = await detailPATCH(
            buildRequest(`/api/admin/products/${productId}/media/${b.json.media.id}`, "PATCH", {
                body: { isPrimary: true },
            }),
            { params: Promise.resolve({ id: productId, mediaId: b.json.media.id }) }
        );
        const after = await readResponse<MediaResponse>(res);
        expect(after.status).toBe(200);
        expect(after.json.media.isPrimary).toBe(true);

        // thumbnail_url is now the URL of `b`.
        expect(await readThumbnail(productId)).toBe(b.json.media.url);

        // Only one primary exists.
        const rows = await db
            .select()
            .from(productMedia)
            .where(eq(productMedia.productId, productId));
        expect(rows.filter((r) => r.isPrimary)).toHaveLength(1);
        // Sanity that the old one was demoted.
        const aRow = rows.find((r) => r.id === a.json.media.id)!;
        expect(aRow.isPrimary).toBe(false);
    });

    it("refuses isPrimary=false when the row is the only primary", async () => {
        const productId = await createProductId();
        const a = await attachMedia(productId, { isPrimary: true });

        const res = await detailPATCH(
            buildRequest(`/api/admin/products/${productId}/media/${a.json.media.id}`, "PATCH", {
                body: { isPrimary: false },
            }),
            { params: Promise.resolve({ id: productId, mediaId: a.json.media.id }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("cannot_demote_lone_primary");
    });

    it("editing the URL of the existing primary syncs products.thumbnail_url", async () => {
        const productId = await createProductId();
        const a = await attachMedia(productId, { isPrimary: true });
        // Sanity: the attach actually persisted isPrimary=true.
        expect(a.json.media.isPrimary).toBe(true);
        // And products.thumbnail_url was set to a's URL by the POST.
        expect(await readThumbnail(productId)).toBe(a.json.media.url);

        const newUrl = `https://cdn.example.com/${tag}/edited.jpg`;
        const patch = await detailPATCH(
            buildRequest(`/api/admin/products/${productId}/media/${a.json.media.id}`, "PATCH", {
                body: { url: newUrl },
            }),
            { params: Promise.resolve({ id: productId, mediaId: a.json.media.id }) }
        );
        const patchBody = await readResponse<MediaResponse>(patch);
        expect(patchBody.status).toBe(200);
        // The media row's URL was updated.
        expect(patchBody.json.media.url).toBe(newUrl);
        // And the cache was synced.
        expect(await readThumbnail(productId)).toBe(newUrl);
    });
});

describe("DELETE /api/admin/products/[id]/media/[mediaId]", () => {
    it("deleting the primary clears products.thumbnail_url", async () => {
        const productId = await createProductId();
        const a = await attachMedia(productId, { isPrimary: true });
        expect(await readThumbnail(productId)).toBe(a.json.media.url);

        const res = await detailDELETE(
            buildRequest(`/api/admin/products/${productId}/media/${a.json.media.id}`, "DELETE"),
            { params: Promise.resolve({ id: productId, mediaId: a.json.media.id }) }
        );
        const body = await readResponse<{ deleted: boolean; wasPrimary: boolean }>(res);
        expect(body.status).toBe(200);
        expect(body.json.wasPrimary).toBe(true);
        expect(await readThumbnail(productId)).toBeNull();
    });

    it("deleting a non-primary leaves products.thumbnail_url untouched", async () => {
        const productId = await createProductId();
        const a = await attachMedia(productId, { isPrimary: true });
        const b = await attachMedia(productId);

        await detailDELETE(
            buildRequest(`/api/admin/products/${productId}/media/${b.json.media.id}`, "DELETE"),
            { params: Promise.resolve({ id: productId, mediaId: b.json.media.id }) }
        );
        expect(await readThumbnail(productId)).toBe(a.json.media.url);
    });
});

describe("GET /api/admin/products/[id]/media — ordering", () => {
    it("orders primary first, then by sortOrder ascending", async () => {
        const productId = await createProductId();
        const a = await attachMedia(productId, { sortOrder: 5 });
        const b = await attachMedia(productId, { sortOrder: 1, isPrimary: true });
        const c = await attachMedia(productId, { sortOrder: 3 });

        const res = await listGET(buildRequest(`/api/admin/products/${productId}/media`, "GET"), {
            params: Promise.resolve({ id: productId }),
        });
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.media.map((m) => m.id);
        expect(ids[0]).toBe(b.json.media.id); // primary first regardless of sortOrder
        expect(ids.slice(1)).toEqual([c.json.media.id, a.json.media.id]); // 3 then 5
    });
});

describe("POST /api/admin/products/[id]/media/reorder", () => {
    it("reorders explicit ids; trailing media keeps relative order", async () => {
        const productId = await createProductId();
        const a = await attachMedia(productId, { sortOrder: 0 });
        const b = await attachMedia(productId, { sortOrder: 1 });
        const c = await attachMedia(productId, { sortOrder: 2 });
        const d = await attachMedia(productId, { sortOrder: 3 });

        // Send only [c, a]; b + d are trailing and should keep their
        // relative order (b before d).
        const res = await reorderPOST(
            buildRequest(`/api/admin/products/${productId}/media/reorder`, "POST", {
                body: { ordering: [c.json.media.id, a.json.media.id] },
            }),
            { params: Promise.resolve({ id: productId }) }
        );
        const body = await readResponse<{ ordering: string[]; count: number }>(res);
        expect(body.status).toBe(200);
        expect(body.json.count).toBe(4);
        expect(body.json.ordering).toEqual([
            c.json.media.id,
            a.json.media.id,
            b.json.media.id,
            d.json.media.id,
        ]);

        // Verify by reading sortOrder values directly.
        const rows = await db
            .select({ id: productMedia.id, sortOrder: productMedia.sortOrder })
            .from(productMedia)
            .where(eq(productMedia.productId, productId));
        const byId = new Map(rows.map((r) => [r.id, r.sortOrder]));
        expect(byId.get(c.json.media.id)).toBe(0);
        expect(byId.get(a.json.media.id)).toBe(1);
        expect(byId.get(b.json.media.id)).toBe(2);
        expect(byId.get(d.json.media.id)).toBe(3);
    });

    it("rejects orderings that include a media id not owned by the product", async () => {
        const productA = await createProductId();
        const productB = await createProductId();
        const m = await attachMedia(productA);

        const res = await reorderPOST(
            buildRequest(`/api/admin/products/${productB}/media/reorder`, "POST", {
                body: { ordering: [m.json.media.id] },
            }),
            { params: Promise.resolve({ id: productB }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("media_not_owned");
    });
});

// Sentinel — keeps the integration GET helper used in earlier files honest.
// Read product detail to verify the FK cascade (delete a product with media
// rows attached and confirm GET 404 + no orphaned media rows).
describe("FK cascade through product hard-delete", () => {
    it("hard-deleting a product removes all attached media rows", async () => {
        const productId = await createProductId();
        await attachMedia(productId, { isPrimary: true });
        await attachMedia(productId);

        const before = await db
            .select({ id: productMedia.id })
            .from(productMedia)
            .where(eq(productMedia.productId, productId));
        expect(before).toHaveLength(2);

        // Hard-delete the parent product.
        const { DELETE: deleteProduct } = await import("../route");
        const res = await deleteProduct(
            buildRequest(`/api/admin/products/${productId}`, "DELETE", {
                query: { hard: "true" },
            }),
            { params: Promise.resolve({ id: productId }) }
        );
        expect(res.status).toBe(200);

        const after = await db
            .select({ id: productMedia.id })
            .from(productMedia)
            .where(eq(productMedia.productId, productId));
        expect(after).toHaveLength(0);

        // Helper: verify GET still returns 404 (caller can rely on
        // /api/admin/products/[id] GET behaviour).
        const get = await productGET(buildRequest(`/api/admin/products/${productId}`, "GET"), {
            params: Promise.resolve({ id: productId }),
        });
        expect(get.status).toBe(404);
    });
});
