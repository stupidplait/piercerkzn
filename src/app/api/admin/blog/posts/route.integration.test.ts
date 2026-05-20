/**
 * Integration tests for `/api/admin/blog/posts` and `/api/admin/blog/posts/[id]`.
 *
 * The most interesting contract here is the publish/scheduled gate:
 *   - status='published' + scheduledAt in the future → forced back to 'draft',
 *     publishedAt stays null (sweeper will publish).
 *   - status='published' (no schedule, or schedule in the past) → publishedAt
 *     stamped immediately.
 *   - First-time transition into 'published' on PATCH stamps publishedAt
 *     (and reports publishedTransition=true). Subsequent toggles keep it.
 *
 * Also covers the silent-default fix: a PATCH that doesn't touch `status`
 * must NOT reset a published post back to draft.
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

const tag = makeTestTag("bp");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface PostRow {
    id: string;
    slug: string;
    title: string;
    status: string;
    publishedAt: string | null;
    scheduledAt: string | null;
    tags: string[] | null;
}
interface CreateResponse {
    post: PostRow;
}
interface PatchResponse {
    post: PostRow;
    publishedTransition: boolean;
}
interface ListResponse {
    posts: (PostRow & { category?: { id: string } | null })[];
    count: number;
    total: number;
}
interface ErrorBody {
    error: { code: string; message: string };
}

let counter = 1;
function nextSlug(): string {
    return `${tag}-${(counter++).toString(36)}`;
}

async function createPost(overrides: Partial<Record<string, unknown>> = {}) {
    const slug = nextSlug();
    const res = await createPOST(
        buildRequest("/api/admin/blog/posts", "POST", {
            body: {
                slug,
                title: `Тест ${slug}`,
                content: "Hello world content body. ".repeat(3),
                ...overrides,
            },
        })
    );
    return { slug, parsed: await readResponse<CreateResponse>(res) };
}

describe("POST /api/admin/blog/posts — create + publish gate", () => {
    it("creates a draft", async () => {
        const { parsed } = await createPost();
        expect(parsed.status).toBe(201);
        expect(parsed.json.post.status).toBe("draft");
        expect(parsed.json.post.publishedAt).toBeNull();
    });

    it("publishing immediately stamps publishedAt", async () => {
        const { parsed } = await createPost({ status: "published" });
        expect(parsed.status).toBe(201);
        expect(parsed.json.post.status).toBe("published");
        expect(parsed.json.post.publishedAt).not.toBeNull();
    });

    it("scheduledAt in the future forces status back to draft (sweeper picks it up later)", async () => {
        const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const { parsed } = await createPost({
            status: "published",
            scheduledAt: future,
        });
        expect(parsed.status).toBe(201);
        // Forced back to draft.
        expect(parsed.json.post.status).toBe("draft");
        expect(parsed.json.post.publishedAt).toBeNull();
        expect(parsed.json.post.scheduledAt).not.toBeNull();
    });

    it("rejects duplicate slug with slug_in_use 409", async () => {
        const slug = nextSlug();
        const first = await createPOST(
            buildRequest("/api/admin/blog/posts", "POST", {
                body: { slug, title: "first", content: "x".repeat(20) },
            })
        );
        expect(first.status).toBe(201);

        const second = await createPOST(
            buildRequest("/api/admin/blog/posts", "POST", {
                body: { slug, title: "second", content: "x".repeat(20) },
            })
        );
        const body = await readResponse<ErrorBody>(second);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("slug_in_use");
    });
});

describe("PATCH /api/admin/blog/posts/[id] — status transitions", () => {
    it("first transition draft → published stamps publishedAt and reports publishedTransition=true", async () => {
        const { parsed } = await createPost();
        const id = parsed.json.post.id;

        const res = await detailPATCH(
            buildRequest(`/api/admin/blog/posts/${id}`, "PATCH", {
                body: { status: "published" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<PatchResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.publishedTransition).toBe(true);
        expect(body.json.post.status).toBe("published");
        expect(body.json.post.publishedAt).not.toBeNull();

        // Toggle published → draft → published; publishedAt is sticky after the first stamp.
        const stampedAt = body.json.post.publishedAt!;
        await detailPATCH(
            buildRequest(`/api/admin/blog/posts/${id}`, "PATCH", {
                body: { status: "draft" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const second = await detailPATCH(
            buildRequest(`/api/admin/blog/posts/${id}`, "PATCH", {
                body: { status: "published" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const secondBody = await readResponse<PatchResponse>(second);
        expect(secondBody.status).toBe(200);
        // Already had publishedAt → no transition this time.
        expect(secondBody.json.publishedTransition).toBe(false);
        expect(secondBody.json.post.publishedAt).toBe(stampedAt);
    });

    it("PATCH that does NOT touch status leaves a published post published", async () => {
        // Regression test for the silent-default bug: zod v4 .partial()
        // preserves .default() values. updateBlogPostSchema must NOT inject
        // status: "draft" into the payload.
        const { parsed } = await createPost({ status: "published" });
        const id = parsed.json.post.id;
        const before = parsed.json.post;
        expect(before.status).toBe("published");

        const res = await detailPATCH(
            buildRequest(`/api/admin/blog/posts/${id}`, "PATCH", {
                body: { title: "Just a title edit" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<PatchResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.post.status).toBe("published");
        expect(body.json.post.title).toBe("Just a title edit");
        // publishedAt preserved.
        expect(body.json.post.publishedAt).toBe(before.publishedAt);
    });

    it("PATCH publishing a post with scheduledAt in the future keeps it as draft", async () => {
        const { parsed } = await createPost();
        const id = parsed.json.post.id;
        const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        const res = await detailPATCH(
            buildRequest(`/api/admin/blog/posts/${id}`, "PATCH", {
                body: { status: "published", scheduledAt: future },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<PatchResponse>(res);
        expect(body.status).toBe(200);
        // Forced back to draft because scheduledAt is in the future.
        expect(body.json.post.status).toBe("draft");
        expect(body.json.post.publishedAt).toBeNull();
        expect(body.json.publishedTransition).toBe(false);
    });
});

describe("DELETE /api/admin/blog/posts/[id]", () => {
    it("soft-deletes (status=archived) by default and is idempotent", async () => {
        const { parsed } = await createPost({ status: "published" });
        const id = parsed.json.post.id;

        const first = await detailDELETE(buildRequest(`/api/admin/blog/posts/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });
        const body1 = await readResponse<{ mode: string; post?: PostRow }>(first);
        expect(body1.status).toBe(200);
        expect(body1.json.mode).toBe("soft");
        expect(body1.json.post?.status).toBe("archived");

        const second = await detailDELETE(buildRequest(`/api/admin/blog/posts/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });
        const body2 = await readResponse<{ alreadyArchived?: boolean }>(second);
        expect(body2.status).toBe(200);
        expect(body2.json.alreadyArchived).toBe(true);
    });

    it("hard-deletes; subsequent GET → 404", async () => {
        const { parsed } = await createPost();
        const id = parsed.json.post.id;
        const res = await detailDELETE(
            buildRequest(`/api/admin/blog/posts/${id}`, "DELETE", {
                query: { hard: "true" },
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);
        const get = await detailGET(buildRequest(`/api/admin/blog/posts/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        expect(get.status).toBe(404);
    });
});

describe("GET /api/admin/blog/posts — list filters", () => {
    it("filters by status", async () => {
        const draft = await createPost();
        const published = await createPost({ status: "published" });

        const res = await listGET(
            buildRequest("/api/admin/blog/posts", "GET", {
                query: { status: "published", search: tag, limit: 100 },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.posts.map((p) => p.id);
        expect(ids).toContain(published.parsed.json.post.id);
        expect(ids).not.toContain(draft.parsed.json.post.id);
    });
});
