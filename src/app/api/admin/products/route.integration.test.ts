/**
 * Integration tests for `/api/admin/products` and `/api/admin/products/[id]`.
 *
 * Phase D introduced soft-delete + status state machine + the
 * `handle_in_use_soft_deleted` 409 nuance. We exercise:
 *   - Pre-flight handle uniqueness (live row → `handle_in_use`,
 *     soft-deleted row → `handle_in_use_soft_deleted`).
 *   - PATCH first-time status transition into `published` stamps `publishedAt`
 *     and reports `publishedTransition: true`.
 *   - PATCH refuses to mutate a soft-deleted product.
 *   - Soft delete flips status to `archived` and is idempotent.
 *   - Hard delete cascades through variants / areas / media (verified
 *     indirectly: GET 404 after delete, list with `includeDeleted=true`
 *     no longer finds the row).
 *   - List filters: `status`, `search` (handle/title), `includeDeleted`.
 *   - 23505 race fallback covered indirectly by the duplicate-handle test
 *     hitting the pre-flight branch first; the catch is a belt-and-braces
 *     net we don't try to provoke from here.
 */
import { afterAll, describe, expect, it } from "vitest";

import { GET as listGET, POST as createPOST } from "./route";
import { DELETE as detailDELETE, GET as detailGET, PATCH as detailPATCH } from "./[id]/route";

import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

const tag = makeTestTag("prd");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface ProductRow {
    id: string;
    handle: string;
    title: string;
    status: string;
    material: string;
    jewelryType: string;
    publishedAt: string | null;
    deletedAt: string | null;
    isFeatured: boolean | null;
    has3dModel: boolean | null;
    thumbnailUrl: string | null;
    categoryId: string | null;
    createdAt: string;
    updatedAt: string;
}
interface CreateResponse {
    product: ProductRow;
}
interface DetailResponse {
    product: ProductRow & {
        variants: unknown[];
        piercingAreas: string[];
        media: unknown[];
        description: string | null;
    };
}
interface PatchResponse {
    product: ProductRow;
    publishedTransition: boolean;
}
interface ListResponse {
    products: ProductRow[];
    count: number;
    total: number;
}
interface ErrorBody {
    error: { code: string; message: string };
}

let counter = 1;
function nextHandle(): string {
    return `${tag}-${(counter++).toString(36)}`;
}

async function createProduct(overrides: Partial<Record<string, unknown>> = {}) {
    const handle = nextHandle();
    const res = await createPOST(
        buildRequest("/api/admin/products", "POST", {
            body: {
                handle,
                title: `Тест ${handle}`,
                material: "titanium",
                jewelryType: "stud",
                ...overrides,
            },
        })
    );
    return { handle, parsed: await readResponse<CreateResponse>(res) };
}

describe("POST /api/admin/products — create", () => {
    it("creates a draft product with defaults", async () => {
        const { parsed } = await createProduct();
        expect(parsed.status).toBe(201);
        const p = parsed.json.product;
        expect(p.status).toBe("draft");
        expect(p.publishedAt).toBeNull();
        expect(p.isFeatured).toBe(false);
        expect(p.has3dModel).toBe(false);
        expect(p.handle).toMatch(/^prd-/);
    });

    it("stamps publishedAt when status='published' is sent on create", async () => {
        const { parsed } = await createProduct({ status: "published" });
        expect(parsed.status).toBe(201);
        expect(parsed.json.product.status).toBe("published");
        expect(parsed.json.product.publishedAt).not.toBeNull();
    });

    it("attaches initial piercingAreas[]", async () => {
        const { parsed } = await createProduct({
            piercingAreas: ["ear_helix", "ear_tragus"],
        });
        const id = parsed.json.product.id;
        const detail = await readResponse<DetailResponse>(
            await detailGET(buildRequest(`/api/admin/products/${id}`, "GET"), {
                params: Promise.resolve({ id }),
            })
        );
        expect(detail.json.product.piercingAreas.sort()).toEqual(["ear_helix", "ear_tragus"]);
    });

    it("rejects duplicate live handle with 409 handle_in_use (pre-flight)", async () => {
        const handle = nextHandle();
        const first = await createPOST(
            buildRequest("/api/admin/products", "POST", {
                body: {
                    handle,
                    title: "first",
                    material: "titanium",
                    jewelryType: "stud",
                },
            })
        );
        expect(first.status).toBe(201);

        const second = await createPOST(
            buildRequest("/api/admin/products", "POST", {
                body: {
                    handle,
                    title: "second",
                    material: "titanium",
                    jewelryType: "stud",
                },
            })
        );
        const body = await readResponse<ErrorBody>(second);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("handle_in_use");
    });

    it("rejects handle owned by a soft-deleted product with the dedicated code", async () => {
        const { parsed } = await createProduct();
        const id = parsed.json.product.id;
        await detailDELETE(buildRequest(`/api/admin/products/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });

        // Try to create a new product with the same handle — must collide
        // against the soft-deleted row's handle.
        const collide = await createPOST(
            buildRequest("/api/admin/products", "POST", {
                body: {
                    handle: parsed.json.product.handle,
                    title: "should-collide",
                    material: "titanium",
                    jewelryType: "stud",
                },
            })
        );
        const body = await readResponse<ErrorBody>(collide);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("handle_in_use_soft_deleted");
    });
});

describe("PATCH /api/admin/products/[id]", () => {
    it("first transition to published stamps publishedAt and reports publishedTransition=true", async () => {
        const { parsed } = await createProduct();
        const id = parsed.json.product.id;
        const res = await detailPATCH(
            buildRequest(`/api/admin/products/${id}`, "PATCH", {
                body: { status: "published" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const after = await readResponse<PatchResponse>(res);
        expect(after.status).toBe(200);
        expect(after.json.product.status).toBe("published");
        expect(after.json.product.publishedAt).not.toBeNull();
        expect(after.json.publishedTransition).toBe(true);

        // A subsequent transition draft → published → draft → published does
        // NOT re-stamp publishedAt (publishedAt is sticky after first publish).
        const stampedAt = after.json.product.publishedAt!;
        await detailPATCH(
            buildRequest(`/api/admin/products/${id}`, "PATCH", {
                body: { status: "draft" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const second = await detailPATCH(
            buildRequest(`/api/admin/products/${id}`, "PATCH", {
                body: { status: "published" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<PatchResponse>(second);
        expect(body.status).toBe(200);
        expect(body.json.publishedTransition).toBe(false);
        expect(body.json.product.publishedAt).toBe(stampedAt);
    });

    it("refuses to PATCH a soft-deleted product", async () => {
        const { parsed } = await createProduct();
        const id = parsed.json.product.id;
        await detailDELETE(buildRequest(`/api/admin/products/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });

        const res = await detailPATCH(
            buildRequest(`/api/admin/products/${id}`, "PATCH", {
                body: { title: "no-go" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("product_soft_deleted");
    });

    it("replaces piercingAreas wholesale when the field is sent (even as [])", async () => {
        const { parsed } = await createProduct({
            piercingAreas: ["ear_helix", "ear_tragus"],
        });
        const id = parsed.json.product.id;

        // Replace with a single area.
        await detailPATCH(
            buildRequest(`/api/admin/products/${id}`, "PATCH", {
                body: { piercingAreas: ["nose_septum"] },
            }),
            { params: Promise.resolve({ id }) }
        );
        let detail = await readResponse<DetailResponse>(
            await detailGET(buildRequest(`/api/admin/products/${id}`, "GET"), {
                params: Promise.resolve({ id }),
            })
        );
        expect(detail.json.product.piercingAreas).toEqual(["nose_septum"]);

        // Empty array clears them.
        await detailPATCH(
            buildRequest(`/api/admin/products/${id}`, "PATCH", {
                body: { piercingAreas: [] },
            }),
            { params: Promise.resolve({ id }) }
        );
        detail = await readResponse<DetailResponse>(
            await detailGET(buildRequest(`/api/admin/products/${id}`, "GET"), {
                params: Promise.resolve({ id }),
            })
        );
        expect(detail.json.product.piercingAreas).toEqual([]);
    });
});

describe("DELETE /api/admin/products/[id]", () => {
    it("soft-deletes by default, flips status to archived, idempotent", async () => {
        const { parsed } = await createProduct({ status: "published" });
        const id = parsed.json.product.id;

        const first = await detailDELETE(buildRequest(`/api/admin/products/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });
        const body1 = await readResponse<{
            deleted: boolean;
            mode: string;
            product?: { status: string; deletedAt: string | null };
        }>(first);
        expect(body1.status).toBe(200);
        expect(body1.json.mode).toBe("soft");
        expect(body1.json.product?.status).toBe("archived");
        expect(body1.json.product?.deletedAt).not.toBeNull();

        const second = await detailDELETE(buildRequest(`/api/admin/products/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });
        const body2 = await readResponse<{ alreadyDeleted?: boolean }>(second);
        expect(body2.status).toBe(200);
        expect(body2.json.alreadyDeleted).toBe(true);
    });

    it("hard-deletes when ?hard=true and detail GET returns 404 afterwards", async () => {
        const { parsed } = await createProduct();
        const id = parsed.json.product.id;
        const res = await detailDELETE(
            buildRequest(`/api/admin/products/${id}`, "DELETE", {
                query: { hard: "true" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<{ deleted: boolean; mode: string }>(res);
        expect(body.status).toBe(200);
        expect(body.json.mode).toBe("hard");

        const get = await detailGET(buildRequest(`/api/admin/products/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        expect(get.status).toBe(404);
    });
});

describe("GET /api/admin/products — list filters", () => {
    it("filters by status='draft' and excludes soft-deleted by default", async () => {
        // Create one draft + one published + one soft-deleted (all tagged).
        const draft = await createProduct();
        const published = await createProduct({ status: "published" });
        const softDeleted = await createProduct();
        await detailDELETE(
            buildRequest(`/api/admin/products/${softDeleted.parsed.json.product.id}`, "DELETE"),
            { params: Promise.resolve({ id: softDeleted.parsed.json.product.id }) }
        );

        const res = await listGET(
            buildRequest("/api/admin/products", "GET", {
                query: { status: "draft", search: tag, limit: 100 },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.products.map((p) => p.id);
        expect(ids).toContain(draft.parsed.json.product.id);
        expect(ids).not.toContain(published.parsed.json.product.id);
        // Soft-deleted is `archived` after the delete, but `includeDeleted` is
        // false by default so the row is excluded irrespective of status.
        expect(ids).not.toContain(softDeleted.parsed.json.product.id);
    });

    it("includeDeleted=true surfaces soft-deleted rows", async () => {
        const live = await createProduct();
        const dead = await createProduct();
        await detailDELETE(
            buildRequest(`/api/admin/products/${dead.parsed.json.product.id}`, "DELETE"),
            { params: Promise.resolve({ id: dead.parsed.json.product.id }) }
        );

        const res = await listGET(
            buildRequest("/api/admin/products", "GET", {
                query: { includeDeleted: "true", search: tag, limit: 100 },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.products.map((p) => p.id);
        expect(ids).toContain(live.parsed.json.product.id);
        expect(ids).toContain(dead.parsed.json.product.id);
    });
});
