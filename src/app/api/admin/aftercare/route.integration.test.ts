/**
 * Integration tests for `/api/admin/aftercare` and `/api/admin/aftercare/[id]`.
 *
 * Covers:
 *   - Cross-field rule (`healingMaxWeeks >= healingMinWeeks`) on POST and on
 *     PATCH partial-merge (existing min retained when only max changes).
 *   - PATCH preserves untouched fields (smoke test for the `.partial()` path).
 *   - Soft delete flips `isPublished=false` and is idempotent; hard delete
 *     removes the row.
 *   - Hard-delete FK guard against active aftercare_tracking is hard to
 *     exercise without a customer fixture; we confirm the soft path instead.
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

const tag = makeTestTag("ac");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface GuideRow {
    id: string;
    handle: string;
    title: string;
    piercingType: string;
    healingMinWeeks: number | null;
    healingMaxWeeks: number | null;
    isPublished: boolean | null;
    version: number | null;
}
interface CreateResponse {
    guide: GuideRow;
}
interface ListResponse {
    guides: GuideRow[];
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

async function createGuide(overrides: Partial<Record<string, unknown>> = {}) {
    const handle = nextHandle();
    const res = await createPOST(
        buildRequest("/api/admin/aftercare", "POST", {
            body: {
                handle,
                title: `Гайд ${handle}`,
                piercingType: "ear_helix",
                content: { overview: "ok" },
                ...overrides,
            },
        })
    );
    return { handle, parsed: await readResponse<CreateResponse>(res) };
}

describe("POST /api/admin/aftercare — cross-field validation", () => {
    it("rejects healingMaxWeeks < healingMinWeeks", async () => {
        const res = await createPOST(
            buildRequest("/api/admin/aftercare", "POST", {
                body: {
                    handle: nextHandle(),
                    title: "bad",
                    piercingType: "ear_helix",
                    content: {},
                    healingMinWeeks: 12,
                    healingMaxWeeks: 4,
                },
            })
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("healing_range_invalid");
    });

    it("accepts equal min/max", async () => {
        const { parsed } = await createGuide({
            healingMinWeeks: 8,
            healingMaxWeeks: 8,
        });
        expect(parsed.status).toBe(201);
    });

    it("rejects duplicate handle with handle_in_use 409 (pre-flight)", async () => {
        const handle = nextHandle();
        const first = await createPOST(
            buildRequest("/api/admin/aftercare", "POST", {
                body: {
                    handle,
                    title: "first",
                    piercingType: "ear_helix",
                    content: {},
                },
            })
        );
        expect(first.status).toBe(201);

        const second = await createPOST(
            buildRequest("/api/admin/aftercare", "POST", {
                body: {
                    handle,
                    title: "second",
                    piercingType: "ear_helix",
                    content: {},
                },
            })
        );
        const body = await readResponse<ErrorBody>(second);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("handle_in_use");
    });
});

describe("PATCH /api/admin/aftercare/[id] — merged-row cross-field check", () => {
    it("rejects max < existing min on partial patch", async () => {
        const { parsed } = await createGuide({
            healingMinWeeks: 12,
            healingMaxWeeks: 24,
        });
        const id = parsed.json.guide.id;

        const res = await detailPATCH(
            buildRequest(`/api/admin/aftercare/${id}`, "PATCH", {
                body: { healingMaxWeeks: 4 },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("healing_range_invalid");
    });

    it("accepts a clean patch and preserves untouched fields", async () => {
        const { parsed } = await createGuide({
            healingMinWeeks: 6,
            healingMaxWeeks: 12,
            isPublished: true,
        });
        const id = parsed.json.guide.id;

        const res = await detailPATCH(
            buildRequest(`/api/admin/aftercare/${id}`, "PATCH", {
                body: { title: "Updated title" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<{ guide: GuideRow }>(res);
        expect(body.status).toBe(200);
        expect(body.json.guide.title).toBe("Updated title");
        // Untouched fields:
        expect(body.json.guide.healingMinWeeks).toBe(6);
        expect(body.json.guide.healingMaxWeeks).toBe(12);
        expect(body.json.guide.isPublished).toBe(true);
    });
});

describe("DELETE /api/admin/aftercare/[id]", () => {
    it("soft-delete flips isPublished to false; idempotent on second call", async () => {
        const { parsed } = await createGuide();
        const id = parsed.json.guide.id;

        const first = await detailDELETE(buildRequest(`/api/admin/aftercare/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });
        const body1 = await readResponse<{ mode: string; guide?: GuideRow }>(first);
        expect(body1.status).toBe(200);
        expect(body1.json.mode).toBe("soft");
        expect(body1.json.guide?.isPublished).toBe(false);

        const second = await detailDELETE(buildRequest(`/api/admin/aftercare/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });
        const body2 = await readResponse<{ alreadyUnpublished?: boolean }>(second);
        expect(body2.json.alreadyUnpublished).toBe(true);
    });

    it("hard-delete removes the row; subsequent GET → 404", async () => {
        const { parsed } = await createGuide();
        const id = parsed.json.guide.id;

        const res = await detailDELETE(
            buildRequest(`/api/admin/aftercare/${id}`, "DELETE", {
                query: { hard: "true" },
            }),
            { params: Promise.resolve({ id }) }
        );
        expect(res.status).toBe(200);

        const get = await detailGET(buildRequest(`/api/admin/aftercare/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        expect(get.status).toBe(404);
    });
});

describe("GET /api/admin/aftercare — list filters", () => {
    it("filters by isPublished and search across handle/title/piercingType", async () => {
        const live = await createGuide({ piercingType: "ear_helix", isPublished: true });
        const dead = await createGuide();
        await detailDELETE(
            buildRequest(`/api/admin/aftercare/${dead.parsed.json.guide.id}`, "DELETE"),
            { params: Promise.resolve({ id: dead.parsed.json.guide.id }) }
        );

        const res = await listGET(
            buildRequest("/api/admin/aftercare", "GET", {
                query: { isPublished: "true", search: tag, limit: 100 },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.guides.map((g) => g.id);
        expect(ids).toContain(live.parsed.json.guide.id);
        expect(ids).not.toContain(dead.parsed.json.guide.id);
    });
});
