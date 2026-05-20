/**
 * Integration tests for `/api/admin/schedule/blocks` and `/[id]`.
 *
 * Time blocks are the simplest E5 surface — no FK guards, no soft delete.
 * We focus on:
 *   - PATCH cross-field re-merge (`endTime > startTime`).
 *   - List filters: exact date vs from/to range (the date filter is
 *     intentionally ignored when from/to is set).
 *   - DELETE 404 path.
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

const tag = makeTestTag("blk");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface BlockRow {
    id: string;
    date: string;
    startTime: string;
    endTime: string;
    reason: string | null;
}
interface BlockResponse {
    block: BlockRow;
}
interface ListResponse {
    blocks: BlockRow[];
    count: number;
    total: number;
}
interface ErrorBody {
    error: { code: string; message: string };
}

let dayCounter = 1;
function nextDate(): string {
    const d = String(dayCounter++).padStart(2, "0");
    return `2099-02-${d}`;
}

async function createBlock(overrides: Partial<Record<string, unknown>> = {}) {
    const date = nextDate();
    const res = await createPOST(
        buildRequest("/api/admin/schedule/blocks", "POST", {
            body: {
                date,
                startTime: "12:00",
                endTime: "13:00",
                reason: `${tag}-default`,
                ...overrides,
            },
        })
    );
    return { date, parsed: await readResponse<BlockResponse>(res) };
}

describe("POST /api/admin/schedule/blocks", () => {
    it("creates a block with reason tag and round-trips times", async () => {
        const { parsed, date } = await createBlock();
        expect(parsed.status).toBe(201);
        expect(parsed.json.block.date).toBe(date);
        expect(parsed.json.block.startTime).toMatch(/^12:00(:00)?$/);
        expect(parsed.json.block.endTime).toMatch(/^13:00(:00)?$/);
    });

    it("rejects endTime <= startTime at the schema layer", async () => {
        const date = nextDate();
        const res = await createPOST(
            buildRequest("/api/admin/schedule/blocks", "POST", {
                body: {
                    date,
                    startTime: "12:00",
                    endTime: "11:00",
                    reason: `${tag}-bad`,
                },
            })
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(422);
        expect(body.json.error.code).toBe("validation_error");
    });
});

describe("PATCH /api/admin/schedule/blocks/[id]", () => {
    it("rejects endTime <= existing startTime on partial patch", async () => {
        const { parsed } = await createBlock({
            startTime: "12:00",
            endTime: "13:00",
            reason: `${tag}-cross`,
        });
        const id = parsed.json.block.id;

        const res = await detailPATCH(
            buildRequest(`/api/admin/schedule/blocks/${id}`, "PATCH", {
                body: { endTime: "11:00" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("end_before_start");
    });

    it("accepts a clean patch and round-trips through GET", async () => {
        const { parsed } = await createBlock({ reason: `${tag}-roundtrip` });
        const id = parsed.json.block.id;

        const res = await detailPATCH(
            buildRequest(`/api/admin/schedule/blocks/${id}`, "PATCH", {
                body: { startTime: "14:00", endTime: "15:30", reason: `${tag}-updated` },
            }),
            { params: Promise.resolve({ id }) }
        );
        const after = await readResponse<BlockResponse>(res);
        expect(after.status).toBe(200);

        const get = await detailGET(buildRequest(`/api/admin/schedule/blocks/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        const fetched = await readResponse<BlockResponse>(get);
        expect(fetched.json.block.startTime).toMatch(/^14:00(:00)?$/);
        expect(fetched.json.block.endTime).toMatch(/^15:30(:00)?$/);
        expect(fetched.json.block.reason).toBe(`${tag}-updated`);
    });
});

describe("DELETE /api/admin/schedule/blocks/[id]", () => {
    it("deletes then 404s on the second attempt", async () => {
        const { parsed } = await createBlock();
        const id = parsed.json.block.id;
        const first = await detailDELETE(
            buildRequest(`/api/admin/schedule/blocks/${id}`, "DELETE"),
            { params: Promise.resolve({ id }) }
        );
        expect(first.status).toBe(200);
        const second = await detailDELETE(
            buildRequest(`/api/admin/schedule/blocks/${id}`, "DELETE"),
            { params: Promise.resolve({ id }) }
        );
        expect(second.status).toBe(404);
    });
});

describe("GET /api/admin/schedule/blocks — filter behaviour", () => {
    it("filters by exact date when from/to are absent", async () => {
        const a = await createBlock({ reason: `${tag}-fA` });
        const b = await createBlock({ reason: `${tag}-fB` });

        const res = await listGET(
            buildRequest("/api/admin/schedule/blocks", "GET", {
                query: { date: a.date, limit: 50 },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.blocks.map((b) => b.id);
        expect(ids).toContain(a.parsed.json.block.id);
        expect(ids).not.toContain(b.parsed.json.block.id);
    });

    it("ignores `date` when from/to is supplied (range wins)", async () => {
        const a = await createBlock({ reason: `${tag}-rangeA` });
        const b = await createBlock({ reason: `${tag}-rangeB` });

        // `date` points to `a`, but we supply a wider range covering both.
        const res = await listGET(
            buildRequest("/api/admin/schedule/blocks", "GET", {
                query: { date: a.date, from: a.date, to: b.date, limit: 50 },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.blocks.map((b) => b.id);
        expect(ids).toContain(a.parsed.json.block.id);
        expect(ids).toContain(b.parsed.json.block.id);
    });
});
