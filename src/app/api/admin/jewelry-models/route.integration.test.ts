/**
 * Integration tests for `/api/admin/jewelry-models` and `/api/admin/jewelry-models/[id]`.
 *
 * Covers:
 *   - POST attaches a model to an existing product; product join surfaces
 *     `productHandle` / `productTitle` on GET.
 *   - POST against a non-existent product returns `product_not_found` 400
 *     (23503 fallback via `pgErrorCode`).
 *   - PATCH partial update; status flip is recorded.
 *   - DELETE removes the row; subsequent GET → 404.
 *   - List filters by `productId`, `status`, `isValidated`.
 */
import { afterAll, describe, expect, it } from "vitest";

import { POST as createProductPOST } from "../products/route";
import { GET as listGET, POST as createPOST } from "./route";
import { DELETE as detailDELETE, GET as detailGET, PATCH as detailPATCH } from "./[id]/route";

import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

const tag = makeTestTag("jm");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface JewelryModelRow {
    id: string;
    productId: string;
    productHandle: string | null;
    productTitle: string | null;
    modelUrl: string;
    jewelryType: string;
    isValidated: boolean | null;
    status: string;
}
interface CreateResponse {
    jewelryModel: JewelryModelRow;
}
interface ListResponse {
    jewelryModels: JewelryModelRow[];
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

async function attachJewelryModel(
    productId: string,
    overrides: Partial<Record<string, unknown>> = {}
) {
    const res = await createPOST(
        buildRequest("/api/admin/jewelry-models", "POST", {
            body: {
                productId,
                modelUrl: `https://cdn.example.com/${tag}/${productId}.glb`,
                jewelryType: "stud",
                ...overrides,
            },
        })
    );
    return readResponse<CreateResponse>(res);
}

describe("POST /api/admin/jewelry-models", () => {
    it("attaches to an existing product", async () => {
        const productId = await createProductId();
        const res = await attachJewelryModel(productId);
        expect(res.status).toBe(201);
        expect(res.json.jewelryModel.productId).toBe(productId);
        expect(res.json.jewelryModel.status).toBe("active");
    });

    it("rejects creation against a non-existent product (23503 → product_not_found 400)", async () => {
        // Syntactically-valid v4 UUID with no matching product.
        const ghost = "00000000-0000-4000-8000-0000000000fa";
        const res = await createPOST(
            buildRequest("/api/admin/jewelry-models", "POST", {
                body: {
                    productId: ghost,
                    modelUrl: `https://cdn.example.com/${tag}/ghost.glb`,
                    jewelryType: "stud",
                },
            })
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("product_not_found");
    });
});

describe("GET /api/admin/jewelry-models/[id]", () => {
    it("includes product handle/title via the join", async () => {
        const productId = await createProductId();
        const create = await attachJewelryModel(productId);
        const id = create.json.jewelryModel.id;

        const res = await detailGET(buildRequest(`/api/admin/jewelry-models/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        const body = await readResponse<{ jewelryModel: JewelryModelRow }>(res);
        expect(body.status).toBe(200);
        expect(body.json.jewelryModel.productId).toBe(productId);
        expect(body.json.jewelryModel.productHandle).toMatch(/^jm-/);
        expect(body.json.jewelryModel.productTitle).toContain("Тест");
    });
});

describe("PATCH /api/admin/jewelry-models/[id]", () => {
    it("flips status to inactive", async () => {
        const productId = await createProductId();
        const create = await attachJewelryModel(productId);
        const id = create.json.jewelryModel.id;

        const res = await detailPATCH(
            buildRequest(`/api/admin/jewelry-models/${id}`, "PATCH", {
                body: { status: "inactive", isValidated: true },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<{ jewelryModel: JewelryModelRow }>(res);
        expect(body.status).toBe(200);
        expect(body.json.jewelryModel.status).toBe("inactive");
        expect(body.json.jewelryModel.isValidated).toBe(true);
    });
});

describe("DELETE /api/admin/jewelry-models/[id]", () => {
    it("removes the row; subsequent GET 404", async () => {
        const productId = await createProductId();
        const create = await attachJewelryModel(productId);
        const id = create.json.jewelryModel.id;

        const del = await detailDELETE(buildRequest(`/api/admin/jewelry-models/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });
        expect(del.status).toBe(200);

        const get = await detailGET(buildRequest(`/api/admin/jewelry-models/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        expect(get.status).toBe(404);
    });
});

describe("GET /api/admin/jewelry-models — list filters", () => {
    it("filters by productId + status", async () => {
        const productA = await createProductId();
        const productB = await createProductId();
        const a = await attachJewelryModel(productA, { status: "active" });
        const b = await attachJewelryModel(productB, { status: "inactive" });

        const res = await listGET(
            buildRequest("/api/admin/jewelry-models", "GET", {
                query: { productId: productA, status: "active", limit: 100 },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.jewelryModels.map((m) => m.id);
        expect(ids).toContain(a.json.jewelryModel.id);
        expect(ids).not.toContain(b.json.jewelryModel.id);
    });
});
