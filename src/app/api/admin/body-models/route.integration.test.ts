/**
 * Integration tests for `/api/admin/body-models` and `/api/admin/body-models/[id]`.
 *
 * Covers:
 *   - POST creates a body model with `cameraDefaults` jsonb intact and the
 *     `name`/`area`/`side` round-tripping.
 *   - GET detail returns the row plus the joined `anchorCount` (which
 *     starts at 0 for a fresh model).
 *   - GET list filters by `area`, `side`, and `includeInactive`.
 *   - PATCH leaves untouched fields alone (defaults-on-partial smoke test).
 *   - Soft-delete idempotence; hard-delete removes the row.
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

const tag = makeTestTag("bm");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface BodyModelRow {
    id: string;
    name: string;
    area: string;
    side: string | null;
    modelUrl: string;
    thumbnailUrl: string | null;
    polygonCount: number | null;
    cameraDefaults: Record<string, unknown>;
    skinTextures: unknown;
    version: number | null;
    isActive: boolean | null;
}
interface CreateResponse {
    bodyModel: BodyModelRow;
}
interface DetailResponse {
    bodyModel: BodyModelRow & { anchorCount: number };
}
interface ListResponse {
    bodyModels: BodyModelRow[];
    count: number;
    total: number;
}

let counter = 1;
function nextName(): string {
    return `${tag}-${(counter++).toString(36)}`;
}

async function createBodyModel(overrides: Partial<Record<string, unknown>> = {}) {
    const name = nextName();
    const res = await createPOST(
        buildRequest("/api/admin/body-models", "POST", {
            body: {
                name,
                area: "ear",
                side: "left",
                modelUrl: `https://cdn.example.com/${tag}/${name}.glb`,
                cameraDefaults: { fov: 45 },
                ...overrides,
            },
        })
    );
    return { name, parsed: await readResponse<CreateResponse>(res) };
}

describe("POST /api/admin/body-models", () => {
    it("creates a body model with cameraDefaults intact", async () => {
        const { parsed } = await createBodyModel({
            cameraDefaults: { fov: 50, target: [0, 1, 0] },
        });
        expect(parsed.status).toBe(201);
        expect(parsed.json.bodyModel.cameraDefaults).toEqual({
            fov: 50,
            target: [0, 1, 0],
        });
        expect(parsed.json.bodyModel.isActive).toBe(true);
        expect(parsed.json.bodyModel.area).toBe("ear");
    });

    it("rejects invalid `area` shape (uppercase)", async () => {
        const res = await createPOST(
            buildRequest("/api/admin/body-models", "POST", {
                body: {
                    name: nextName(),
                    area: "EAR",
                    modelUrl: "https://cdn.example.com/x.glb",
                    cameraDefaults: { fov: 45 },
                },
            })
        );
        expect(res.status).toBe(422);
    });
});

describe("GET /api/admin/body-models/[id] — anchorCount", () => {
    it("returns anchorCount=0 for a fresh body model", async () => {
        const { parsed } = await createBodyModel();
        const id = parsed.json.bodyModel.id;
        const res = await detailGET(buildRequest(`/api/admin/body-models/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        const body = await readResponse<DetailResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.bodyModel.anchorCount).toBe(0);
    });
});

describe("PATCH /api/admin/body-models/[id]", () => {
    it("updates only supplied fields and leaves the rest untouched", async () => {
        const { parsed } = await createBodyModel({ side: "right" });
        const id = parsed.json.bodyModel.id;

        const res = await detailPATCH(
            buildRequest(`/api/admin/body-models/${id}`, "PATCH", {
                body: { polygonCount: 75_000 },
            }),
            { params: Promise.resolve({ id }) }
        );
        const after = await readResponse<{ bodyModel: BodyModelRow }>(res);
        expect(after.status).toBe(200);
        expect(after.json.bodyModel.polygonCount).toBe(75_000);
        // Untouched:
        expect(after.json.bodyModel.side).toBe("right");
        expect(after.json.bodyModel.area).toBe("ear");
    });
});

describe("DELETE /api/admin/body-models/[id]", () => {
    it("soft-deletes (isActive=false) and is idempotent", async () => {
        const { parsed } = await createBodyModel();
        const id = parsed.json.bodyModel.id;

        const first = await detailDELETE(buildRequest(`/api/admin/body-models/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });
        const body1 = await readResponse<{
            mode: string;
            bodyModel?: BodyModelRow;
        }>(first);
        expect(body1.status).toBe(200);
        expect(body1.json.mode).toBe("soft");
        expect(body1.json.bodyModel?.isActive).toBe(false);

        const second = await detailDELETE(buildRequest(`/api/admin/body-models/${id}`, "DELETE"), {
            params: Promise.resolve({ id }),
        });
        const body2 = await readResponse<{ alreadyInactive?: boolean }>(second);
        expect(body2.status).toBe(200);
        expect(body2.json.alreadyInactive).toBe(true);
    });

    it("hard-deletes and 404s on subsequent GET", async () => {
        const { parsed } = await createBodyModel();
        const id = parsed.json.bodyModel.id;
        const res = await detailDELETE(
            buildRequest(`/api/admin/body-models/${id}`, "DELETE", {
                query: { hard: "true" },
            }),
            { params: Promise.resolve({ id }) }
        );
        const body = await readResponse<{ mode: string }>(res);
        expect(body.status).toBe(200);
        expect(body.json.mode).toBe("hard");

        const get = await detailGET(buildRequest(`/api/admin/body-models/${id}`, "GET"), {
            params: Promise.resolve({ id }),
        });
        expect(get.status).toBe(404);
    });
});

describe("GET /api/admin/body-models — list", () => {
    it("excludes inactive by default and filters by area + side", async () => {
        const earLeft = await createBodyModel({ area: "ear", side: "left" });
        const earRight = await createBodyModel({ area: "ear", side: "right" });
        const noseCenter = await createBodyModel({ area: "nose", side: null });

        // soft-delete one and verify it's hidden by default.
        const dead = await createBodyModel({ area: "ear", side: "left" });
        await detailDELETE(
            buildRequest(`/api/admin/body-models/${dead.parsed.json.bodyModel.id}`, "DELETE"),
            { params: Promise.resolve({ id: dead.parsed.json.bodyModel.id }) }
        );

        const res = await listGET(
            buildRequest("/api/admin/body-models", "GET", {
                query: { area: "ear", side: "left", limit: 100 },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.bodyModels.map((m) => m.id);
        expect(ids).toContain(earLeft.parsed.json.bodyModel.id);
        expect(ids).not.toContain(earRight.parsed.json.bodyModel.id);
        expect(ids).not.toContain(noseCenter.parsed.json.bodyModel.id);
        expect(ids).not.toContain(dead.parsed.json.bodyModel.id);
    });

    it("includeInactive=true surfaces inactive rows", async () => {
        const live = await createBodyModel();
        const dead = await createBodyModel();
        await detailDELETE(
            buildRequest(`/api/admin/body-models/${dead.parsed.json.bodyModel.id}`, "DELETE"),
            { params: Promise.resolve({ id: dead.parsed.json.bodyModel.id }) }
        );

        const res = await listGET(
            buildRequest("/api/admin/body-models", "GET", {
                query: { includeInactive: "true", limit: 100 },
            })
        );
        const body = await readResponse<ListResponse>(res);
        expect(body.status).toBe(200);
        const ids = body.json.bodyModels.map((m) => m.id);
        expect(ids).toContain(live.parsed.json.bodyModel.id);
        expect(ids).toContain(dead.parsed.json.bodyModel.id);
    });
});
