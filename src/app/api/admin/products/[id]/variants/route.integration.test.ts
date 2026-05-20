/**
 * Integration tests for `/api/admin/products/[id]/variants` and
 * `.../variants/[variantId]`.
 *
 * Covers:
 *   - SKU global uniqueness (`sku_in_use` 409).
 *   - Numeric(5,1) round-trip (`lengthMm`/`diameterMm` come back as strings
 *     from postgres-js).
 *   - GET variant rejects mismatched product/variant pair (404, no leak).
 *   - PATCH soft-deleted variant returns `variant_soft_deleted`.
 *   - Soft delete idempotent + hard delete removes the row.
 *   - GET list ?includeDeleted=true surfaces soft-deleted variants.
 */
import { afterAll, describe, expect, it } from "vitest";

import { POST as createProductPOST } from "../../route";
import { GET as listGET, POST as createPOST } from "./route";
import {
    DELETE as detailDELETE,
    GET as detailGET,
    PATCH as detailPATCH,
} from "./[variantId]/route";

import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

const tag = makeTestTag("var");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface VariantRow {
    id: string;
    productId: string;
    title: string;
    sku: string | null;
    lengthMm: string | null;
    diameterMm: string | null;
    priceRub: number;
    inventoryQuantity: number | null;
    sortOrder: number | null;
    deletedAt: string | null;
}
interface VariantResponse {
    variant: VariantRow;
}
interface ListResponse {
    variants: VariantRow[];
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

async function createVariant(productId: string, overrides: Partial<Record<string, unknown>> = {}) {
    const res = await createPOST(
        buildRequest(`/api/admin/products/${productId}/variants`, "POST", {
            body: {
                title: `var-${Math.random().toString(36).slice(2, 6)}`,
                priceRub: 12_000,
                ...overrides,
            },
        }),
        { params: Promise.resolve({ id: productId }) }
    );
    return readResponse<VariantResponse>(res);
}

describe("POST /api/admin/products/[id]/variants — create", () => {
    it("creates a variant with defaults; numeric(5,1) round-trips as a string", async () => {
        const productId = await createProductId();
        const res = await createVariant(productId, {
            lengthMm: 6.5,
            diameterMm: 1.2,
        });
        expect(res.status).toBe(201);
        const v = res.json.variant;
        expect(v.productId).toBe(productId);
        // postgres-js returns numeric() as string; the route stringifies on
        // insert, so we expect "6.5" / "1.2" round-trips.
        expect(v.lengthMm).toBe("6.5");
        expect(v.diameterMm).toBe("1.2");
        expect(v.inventoryQuantity).toBe(0); // schema default
    });

    it("rejects duplicate SKU with sku_in_use 409 (global uniqueness)", async () => {
        const productA = await createProductId();
        const productB = await createProductId();
        const sku = `${tag}-sku-${Date.now().toString(36)}`;

        const first = await createVariant(productA, { sku });
        expect(first.status).toBe(201);

        const second = await createVariant(productB, { sku });
        expect(second.status).toBe(409);
        expect((second.json as unknown as ErrorBody).error.code).toBe("sku_in_use");
    });

    it("rejects creation under a missing product with 404", async () => {
        // Syntactically-valid v4 UUID that no product owns.
        const ghostId = "00000000-0000-4000-8000-0000000000aa";
        const res = await createPOST(
            buildRequest(`/api/admin/products/${ghostId}/variants`, "POST", {
                body: { title: "ghost", priceRub: 100 },
            }),
            { params: Promise.resolve({ id: ghostId }) }
        );
        expect(res.status).toBe(404);
    });
});

describe("GET/PATCH/DELETE /api/admin/products/[id]/variants/[variantId]", () => {
    it("GET rejects a variant id that belongs to a different product (404, no leak)", async () => {
        const productA = await createProductId();
        const productB = await createProductId();
        const v = await createVariant(productA);
        const variantId = v.json.variant.id;

        const res = await detailGET(
            buildRequest(`/api/admin/products/${productB}/variants/${variantId}`, "GET"),
            { params: Promise.resolve({ id: productB, variantId }) }
        );
        expect(res.status).toBe(404);
    });

    it("PATCH refuses on a soft-deleted variant", async () => {
        const productId = await createProductId();
        const v = await createVariant(productId);
        const variantId = v.json.variant.id;

        await detailDELETE(
            buildRequest(`/api/admin/products/${productId}/variants/${variantId}`, "DELETE"),
            { params: Promise.resolve({ id: productId, variantId }) }
        );

        const res = await detailPATCH(
            buildRequest(`/api/admin/products/${productId}/variants/${variantId}`, "PATCH", {
                body: { title: "no-go" },
            }),
            { params: Promise.resolve({ id: productId, variantId }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("variant_soft_deleted");
    });

    it("soft delete is idempotent; hard delete removes the row", async () => {
        const productId = await createProductId();
        const v = await createVariant(productId);
        const variantId = v.json.variant.id;

        const first = await detailDELETE(
            buildRequest(`/api/admin/products/${productId}/variants/${variantId}`, "DELETE"),
            { params: Promise.resolve({ id: productId, variantId }) }
        );
        const body1 = await readResponse<{ mode: string }>(first);
        expect(body1.status).toBe(200);
        expect(body1.json.mode).toBe("soft");

        const second = await detailDELETE(
            buildRequest(`/api/admin/products/${productId}/variants/${variantId}`, "DELETE"),
            { params: Promise.resolve({ id: productId, variantId }) }
        );
        const body2 = await readResponse<{ alreadyDeleted?: boolean }>(second);
        expect(body2.status).toBe(200);
        expect(body2.json.alreadyDeleted).toBe(true);

        const hard = await detailDELETE(
            buildRequest(`/api/admin/products/${productId}/variants/${variantId}`, "DELETE", {
                query: { hard: "true" },
            }),
            { params: Promise.resolve({ id: productId, variantId }) }
        );
        const body3 = await readResponse<{ mode: string }>(hard);
        expect(body3.status).toBe(200);
        expect(body3.json.mode).toBe("hard");

        const get = await detailGET(
            buildRequest(`/api/admin/products/${productId}/variants/${variantId}`, "GET"),
            { params: Promise.resolve({ id: productId, variantId }) }
        );
        expect(get.status).toBe(404);
    });
});

describe("GET /api/admin/products/[id]/variants — list", () => {
    it("includeDeleted=true surfaces soft-deleted variants; default hides them", async () => {
        const productId = await createProductId();
        const live = await createVariant(productId);
        const dead = await createVariant(productId);
        await detailDELETE(
            buildRequest(
                `/api/admin/products/${productId}/variants/${dead.json.variant.id}`,
                "DELETE"
            ),
            { params: Promise.resolve({ id: productId, variantId: dead.json.variant.id }) }
        );

        const def = await listGET(
            buildRequest(`/api/admin/products/${productId}/variants`, "GET"),
            { params: Promise.resolve({ id: productId }) }
        );
        const defBody = await readResponse<ListResponse>(def);
        const defIds = defBody.json.variants.map((v) => v.id);
        expect(defIds).toContain(live.json.variant.id);
        expect(defIds).not.toContain(dead.json.variant.id);

        const all = await listGET(
            buildRequest(`/api/admin/products/${productId}/variants`, "GET", {
                query: { includeDeleted: "true" },
            }),
            { params: Promise.resolve({ id: productId }) }
        );
        const allBody = await readResponse<ListResponse>(all);
        const allIds = allBody.json.variants.map((v) => v.id);
        expect(allIds).toContain(live.json.variant.id);
        expect(allIds).toContain(dead.json.variant.id);
    });
});
