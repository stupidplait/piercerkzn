/**
 * Integration tests for `PUT /api/admin/products/[id]/piercing-areas`.
 *
 * Atomic replace endpoint — wholesale set of areas in one transaction.
 * Covers:
 *   - Replacing a non-empty set with another set.
 *   - Empty array clears the join rows.
 *   - Duplicate areas in the payload are de-duped (no 23505).
 *   - Refuses on a soft-deleted product.
 */
import { afterAll, describe, expect, it } from "vitest";

import { POST as createProductPOST } from "../../route";
import { DELETE as productDELETE, GET as productGET } from "../route";
import { PUT } from "./route";

import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

const tag = makeTestTag("area");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface ProductDetail {
    product: { piercingAreas: string[] };
}
interface ErrorBody {
    error: { code: string; message: string };
}

let counter = 1;
function nextHandle(): string {
    return `${tag}-${(counter++).toString(36)}`;
}

async function createProductId(initialAreas?: string[]): Promise<string> {
    const handle = nextHandle();
    const res = await createProductPOST(
        buildRequest("/api/admin/products", "POST", {
            body: {
                handle,
                title: `Тест ${handle}`,
                material: "titanium",
                jewelryType: "stud",
                piercingAreas: initialAreas,
            },
        })
    );
    const parsed = await readResponse<{ product: { id: string } }>(res);
    return parsed.json.product.id;
}

async function readAreas(id: string): Promise<string[]> {
    const res = await productGET(buildRequest(`/api/admin/products/${id}`, "GET"), {
        params: Promise.resolve({ id }),
    });
    const body = await readResponse<ProductDetail>(res);
    return body.json.product.piercingAreas;
}

describe("PUT /api/admin/products/[id]/piercing-areas", () => {
    it("replaces a non-empty set with another set", async () => {
        const id = await createProductId(["ear_helix", "ear_tragus"]);
        const res = await PUT(
            buildRequest(`/api/admin/products/${id}/piercing-areas`, "PUT", {
                body: { areas: ["nose_septum", "lip_labret"] },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<{ areas: string[] }>(res);
        expect(body.status).toBe(200);
        expect(body.json.areas.sort()).toEqual(["lip_labret", "nose_septum"]);

        const stored = await readAreas(id);
        expect(stored.sort()).toEqual(["lip_labret", "nose_septum"]);
    });

    it("empty array clears all area links", async () => {
        const id = await createProductId(["ear_helix", "ear_lobe"]);
        const res = await PUT(
            buildRequest(`/api/admin/products/${id}/piercing-areas`, "PUT", {
                body: { areas: [] },
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
        const stored = await readAreas(id);
        expect(stored).toEqual([]);
    });

    it("de-dupes the payload — duplicate values do not 23505", async () => {
        const id = await createProductId();
        const res = await PUT(
            buildRequest(`/api/admin/products/${id}/piercing-areas`, "PUT", {
                body: { areas: ["ear_helix", "ear_helix", "ear_tragus"] },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<{ areas: string[] }>(res);
        expect(body.status).toBe(200);
        expect(body.json.areas.sort()).toEqual(["ear_helix", "ear_tragus"]);
    });

    it("refuses on a soft-deleted product", async () => {
        const id = await createProductId();
        await productDELETE(buildRequest(`/api/admin/products/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });

        const res = await PUT(
            buildRequest(`/api/admin/products/${id}/piercing-areas`, "PUT", {
                body: { areas: ["ear_helix"] },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("product_soft_deleted");
    });
});
