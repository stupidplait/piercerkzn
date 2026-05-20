/**
 * Integration tests for `/api/admin/blog/categories` and
 * `/api/admin/blog/categories/[id]`.
 *
 * Covers:
 *   - POST + 23505 path (handle_in_use 409). Pre-flight check is hit first;
 *     the catch is a belt-and-braces net we don't try to provoke.
 *   - GET list returns `postCount` for each category.
 *   - DELETE refuses with 409 when posts still reference the category.
 *   - PATCH refuses duplicate handle (23505 fallback via pgErrorCode).
 */
import { afterAll, describe, expect, it } from "vitest";

import { GET as listGET, POST as createPOST } from "./route";
import { DELETE as detailDELETE, GET as detailGET, PATCH as detailPATCH } from "./[id]/route";
import { POST as createPostPOST } from "../posts/route";

import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

const tag = makeTestTag("bcat");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface CategoryRow {
    id: string;
    handle: string;
    name: string;
    sortOrder: number | null;
    postCount?: number;
}
interface CreateResponse {
    category: CategoryRow;
}
interface DetailResponse {
    category: CategoryRow & { postCount: number };
}
interface ListResponse {
    categories: CategoryRow[];
    count: number;
}
interface ErrorBody {
    error: { code: string; message: string };
}

let counter = 1;
function nextHandle(): string {
    return `${tag}-${(counter++).toString(36)}`;
}

async function createCategory(overrides: Partial<Record<string, unknown>> = {}) {
    const handle = nextHandle();
    const res = await createPOST(
        buildRequest("/api/admin/blog/categories", "POST", {
            body: { handle, name: `Категория ${handle}`, ...overrides },
        })
    );
    return { handle, parsed: await readResponse<CreateResponse>(res) };
}

describe("POST /api/admin/blog/categories", () => {
    it("creates a category", async () => {
        const { parsed } = await createCategory();
        expect(parsed.status).toBe(201);
        expect(parsed.json.category.handle).toMatch(/^bcat-/);
    });

    it("rejects duplicate handle with handle_in_use 409 (pre-flight)", async () => {
        const handle = nextHandle();
        const first = await createPOST(
            buildRequest("/api/admin/blog/categories", "POST", {
                body: { handle, name: "first" },
            })
        );
        expect(first.status).toBe(201);

        const second = await createPOST(
            buildRequest("/api/admin/blog/categories", "POST", {
                body: { handle, name: "second" },
            })
        );
        const body = await readResponse<ErrorBody>(second);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("handle_in_use");
    });
});

describe("GET /api/admin/blog/categories — postCount", () => {
    it("returns post counts joined to each category", async () => {
        const { parsed } = await createCategory();
        const categoryId = parsed.json.category.id;

        // Attach two posts to it.
        for (let i = 0; i < 2; i++) {
            const slug = `${tag}-post-${i}-${Date.now().toString(36)}`;
            const res = await createPostPOST(
                buildRequest("/api/admin/blog/posts", "POST", {
                    body: {
                        slug,
                        title: `Test ${slug}`,
                        content: "x".repeat(20),
                        categoryId,
                    },
                })
            );
            expect(res.status).toBe(201);
        }

        const res = await listGET();
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const found = body.json.categories.find((c) => c.id === categoryId);
        expect(found).toBeDefined();
        expect(found?.postCount).toBe(2);
    });
});

describe("DELETE /api/admin/blog/categories/[id]", () => {
    it("refuses with category_in_use when posts still reference it", async () => {
        const { parsed } = await createCategory();
        const categoryId = parsed.json.category.id;

        const slug = `${tag}-blocking-${Date.now().toString(36)}`;
        const created = await createPostPOST(
            buildRequest("/api/admin/blog/posts", "POST", {
                body: { slug, title: "blocker", content: "x".repeat(20), categoryId },
            })
        );
        expect(created.status).toBe(201);

        const res = await detailDELETE(
            buildRequest(`/api/admin/blog/categories/${categoryId}`, "DELETE"),
            { params: Promise.resolve({ id: categoryId }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("category_in_use");
    });

    it("hard-deletes a category with no posts; subsequent GET → 404", async () => {
        const { parsed } = await createCategory();
        const categoryId = parsed.json.category.id;

        const res = await detailDELETE(
            buildRequest(`/api/admin/blog/categories/${categoryId}`, "DELETE"),
            { params: Promise.resolve({ id: categoryId }) }
        );
        expect(res.status).toBe(200);

        const get = await detailGET(
            buildRequest(`/api/admin/blog/categories/${categoryId}`, "GET"),
            { params: Promise.resolve({ id: categoryId }) }
        );
        expect(get.status).toBe(404);
    });
});

describe("PATCH /api/admin/blog/categories/[id]", () => {
    it("rejects duplicate handle on PATCH (23505 → handle_in_use 409)", async () => {
        const a = await createCategory();
        const b = await createCategory();

        const res = await detailPATCH(
            buildRequest(`/api/admin/blog/categories/${b.parsed.json.category.id}`, "PATCH", {
                body: { handle: a.parsed.json.category.handle },
            }),
            { params: Promise.resolve({ id: b.parsed.json.category.id }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("handle_in_use");
    });

    it("returns the updated detail row", async () => {
        const { parsed } = await createCategory();
        const id = parsed.json.category.id;

        const res = await detailPATCH(
            buildRequest(`/api/admin/blog/categories/${id}`, "PATCH", {
                body: { name: "Updated", sortOrder: 5 },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<{ category: CategoryRow }>(res);
        expect(body.status).toBe(200);
        expect(body.json.category.name).toBe("Updated");
        expect(body.json.category.sortOrder).toBe(5);

        // Detail GET reflects it + reports postCount=0.
        const get = await detailGET(buildRequest(`/api/admin/blog/categories/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        const detail = await readResponse<DetailResponse>(get);
        expect(detail.json.category.postCount).toBe(0);
    });
});
