/**
 * Integration tests for `/api/admin/body-models/[id]/anchors`,
 * `.../anchors/[anchorId]`, and `.../anchors/import`.
 *
 * Covers:
 *   - POST append: numeric round-trip (position/normal as strings).
 *   - POST duplicate machine name → 23505 → `anchor_name_in_use` 409.
 *   - PUT bulk-replace wipes existing rows; rejects in-payload duplicates
 *     with a friendly 400 before the unique index trips.
 *   - PATCH single anchor; mismatched body-model/anchor pair returns 404.
 *   - DELETE removes the row.
 *   - Import endpoint accepts the legacy snake_case payload from
 *     `tools/anchor-editor.html` and produces the same row shape.
 */
import { afterAll, describe, expect, it } from "vitest";

import { POST as createBodyModelPOST } from "../../route";
import { GET as listGET, POST as appendPOST, PUT as replacePUT } from "./route";
import { DELETE as detailDELETE, GET as detailGET, PATCH as detailPATCH } from "./[anchorId]/route";
import { POST as importPOST } from "./import/route";

import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

const tag = makeTestTag("anc");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface AnchorRow {
    id: string;
    bodyModelId: string;
    name: string;
    displayName: string;
    positionX: string;
    positionY: string;
    positionZ: string;
    normalX: string;
    normalY: string;
    normalZ: string;
    compatibleJewelryTypes: string[];
    compatibleGauges: string[] | null;
    sortOrder: number | null;
    isActive: boolean | null;
}
interface AnchorResponse {
    anchor: AnchorRow;
}
interface ListResponse {
    anchors: AnchorRow[];
    count: number;
}
interface ReplaceResponse {
    anchors: AnchorRow[];
    count: number;
    mode: "replace" | "import";
}
interface ErrorBody {
    error: { code: string; message: string };
}

let counter = 1;
function nextName(suffix = "anc") {
    return `${tag}-${suffix}-${(counter++).toString(36)}`;
}

async function createBodyModelId(): Promise<string> {
    const name = nextName("model");
    const res = await createBodyModelPOST(
        buildRequest("/api/admin/body-models", "POST", {
            body: {
                name,
                area: "ear",
                modelUrl: `https://cdn.example.com/${tag}/${name}.glb`,
                cameraDefaults: { fov: 45 },
            },
        })
    );
    const parsed = await readResponse<{ bodyModel: { id: string } }>(res);
    return parsed.json.bodyModel.id;
}

const baseAnchor = (name: string) => ({
    name,
    displayName: `Display ${name}`,
    position: { x: 0.1, y: 0.2, z: 0.3 },
    normal: { x: 0, y: 1, z: 0 },
    compatibleJewelryTypes: ["stud"],
});

describe("POST /api/admin/body-models/[id]/anchors — append", () => {
    it("creates a single anchor with numeric coords round-tripped as strings", async () => {
        const bodyModelId = await createBodyModelId();
        const res = await appendPOST(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors`, "POST", {
                body: baseAnchor("helix_upper_1"),
            }),
            { params: Promise.resolve({ id: bodyModelId }) }
        );
        const body = await readResponse<AnchorResponse>(res);
        expect(body.status).toBe(201);
        // numeric(8,4) round-trips as a string with the precision applied.
        expect(body.json.anchor.positionX).toMatch(/^0\.1000?$/);
        expect(body.json.anchor.normalY).toMatch(/^1\.0000?$/);
        expect(body.json.anchor.compatibleJewelryTypes).toEqual(["stud"]);
    });

    it("rejects duplicate name within a body model with anchor_name_in_use 409", async () => {
        const bodyModelId = await createBodyModelId();
        const a = baseAnchor("dup_name");
        const first = await appendPOST(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors`, "POST", { body: a }),
            { params: Promise.resolve({ id: bodyModelId }) }
        );
        expect(first.status).toBe(201);

        const second = await appendPOST(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors`, "POST", { body: a }),
            { params: Promise.resolve({ id: bodyModelId }) }
        );
        const body = await readResponse<ErrorBody>(second);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("anchor_name_in_use");
    });
});

describe("PUT /api/admin/body-models/[id]/anchors — bulk replace", () => {
    it("wipes existing anchors and inserts the new set", async () => {
        const bodyModelId = await createBodyModelId();
        // Pre-populate with one anchor.
        await appendPOST(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors`, "POST", {
                body: baseAnchor("old_anchor"),
            }),
            { params: Promise.resolve({ id: bodyModelId }) }
        );

        const res = await replacePUT(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors`, "PUT", {
                body: {
                    anchors: [baseAnchor("new_a"), baseAnchor("new_b")],
                },
            }),
            { params: Promise.resolve({ id: bodyModelId }) }
        );
        const body = await readResponse<ReplaceResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.mode).toBe("replace");
        expect(body.json.count).toBe(2);
        const names = body.json.anchors.map((a) => a.name).sort();
        expect(names).toEqual(["new_a", "new_b"]);

        // Old anchor is gone.
        const list = await listGET(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors`, "GET"),
            { params: Promise.resolve({ id: bodyModelId }) }
        );
        const listBody = await readResponse<ListResponse>(list);
        expect(listBody.json.anchors.map((a) => a.name)).not.toContain("old_anchor");
    });

    it("empty array clears all anchors", async () => {
        const bodyModelId = await createBodyModelId();
        await appendPOST(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors`, "POST", {
                body: baseAnchor("to_remove"),
            }),
            { params: Promise.resolve({ id: bodyModelId }) }
        );

        const res = await replacePUT(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors`, "PUT", {
                body: { anchors: [] },
            }),
            { params: Promise.resolve({ id: bodyModelId }) }
        );
        const body = await readResponse<ReplaceResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.count).toBe(0);
    });

    it("rejects in-payload duplicate names with duplicate_anchor_name 400 (pre-flight)", async () => {
        const bodyModelId = await createBodyModelId();
        const res = await replacePUT(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors`, "PUT", {
                body: {
                    anchors: [baseAnchor("same"), baseAnchor("same")],
                },
            }),
            { params: Promise.resolve({ id: bodyModelId }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("duplicate_anchor_name");
    });
});

describe("PATCH/DELETE /api/admin/body-models/[id]/anchors/[anchorId]", () => {
    it("PATCH updates fields; mismatched body-model/anchor pair → 404", async () => {
        const bmA = await createBodyModelId();
        const bmB = await createBodyModelId();
        const create = await appendPOST(
            buildRequest(`/api/admin/body-models/${bmA}/anchors`, "POST", {
                body: baseAnchor("patch_me"),
            }),
            { params: Promise.resolve({ id: bmA }) }
        );
        const created = await readResponse<AnchorResponse>(create);
        const anchorId = created.json.anchor.id;

        // Wrong body model id → 404
        const wrong = await detailGET(
            buildRequest(`/api/admin/body-models/${bmB}/anchors/${anchorId}`, "GET"),
            { params: Promise.resolve({ id: bmB, anchorId }) }
        );
        expect(wrong.status).toBe(404);

        // Right pair → PATCH succeeds
        const res = await detailPATCH(
            buildRequest(`/api/admin/body-models/${bmA}/anchors/${anchorId}`, "PATCH", {
                body: { displayName: "Updated Display" },
            }),
            { params: Promise.resolve({ id: bmA, anchorId }) }
        );
        const body = await readResponse<AnchorResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.anchor.displayName).toBe("Updated Display");
    });

    it("DELETE removes the row; subsequent GET → 404", async () => {
        const bodyModelId = await createBodyModelId();
        const create = await appendPOST(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors`, "POST", {
                body: baseAnchor("doomed"),
            }),
            { params: Promise.resolve({ id: bodyModelId }) }
        );
        const created = await readResponse<AnchorResponse>(create);
        const anchorId = created.json.anchor.id;

        const del = await detailDELETE(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors/${anchorId}`, "DELETE"),
            { params: Promise.resolve({ id: bodyModelId, anchorId }) }
        );
        expect(del.status).toBe(200);

        const get = await detailGET(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors/${anchorId}`, "GET"),
            { params: Promise.resolve({ id: bodyModelId, anchorId }) }
        );
        expect(get.status).toBe(404);
    });
});

describe("POST /api/admin/body-models/[id]/anchors/import — anchor-editor payload", () => {
    it("accepts the legacy flat snake_case shape and inserts equivalent rows", async () => {
        const bodyModelId = await createBodyModelId();
        const res = await importPOST(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors/import`, "POST", {
                body: [
                    {
                        name: "imported_a",
                        display_name: "Imported A",
                        body_area: "ear",
                        position_x: 0.1,
                        position_y: 0.2,
                        position_z: 0.3,
                        normal_x: 0,
                        normal_y: 1,
                        normal_z: 0,
                        compatible_jewelry_types: ["stud"],
                        compatible_gauges: ["18g", "16g"],
                    },
                    {
                        name: "imported_b",
                        // display_name omitted → route should humanise it
                        position_x: 0,
                        position_y: 0,
                        position_z: 0,
                        normal_x: 0,
                        normal_y: 1,
                        normal_z: 0,
                        compatible_jewelry_types: ["hoop"],
                    },
                ],
            }),
            { params: Promise.resolve({ id: bodyModelId }) }
        );
        const body = await readResponse<ReplaceResponse & { source: string }>(res);
        expect(body.status).toBe(200);
        expect(body.json.mode).toBe("import");
        expect(body.json.count).toBe(2);
        const a = body.json.anchors.find((x) => x.name === "imported_a")!;
        expect(a.displayName).toBe("Imported A");
        expect(a.compatibleGauges).toEqual(["18g", "16g"]);
        const b = body.json.anchors.find((x) => x.name === "imported_b")!;
        // Humanised fallback: "imported_b" → "Imported B"
        expect(b.displayName).toBe("Imported B");
    });
});
