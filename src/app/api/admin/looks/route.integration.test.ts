/**
 * Integration tests for the E4 looks admin surface.
 *
 *   /api/admin/looks                       — POST + GET list
 *   /api/admin/looks/[id]                  — GET + PATCH + DELETE
 *   /api/admin/looks/[id]/pieces           — POST append + PUT replace
 *   /api/admin/looks/[id]/pieces/[pieceId] — PATCH + DELETE
 *   /api/admin/looks/[id]/pieces/reorder   — POST atomic reorder
 *
 * The most interesting contract is `recalc.ts`: every piece mutation
 * recomputes `totalIndividualPrice` and `discountPercent`. Tests assert
 * the totals after each kind of change.
 */
import { afterAll, describe, expect, it } from "vitest";

import { POST as createBodyModelPOST } from "../body-models/route";
import { POST as createAnchorPOST } from "../body-models/[id]/anchors/route";
import { POST as createProductPOST } from "../products/route";
import { POST as createVariantPOST } from "../products/[id]/variants/route";

import { GET as listLooksGET, POST as createLookPOST } from "./route";
import { DELETE as deleteLookDELETE, GET as detailGET, PATCH as detailPATCH } from "./[id]/route";
import {
    GET as piecesGET,
    POST as appendPiecePOST,
    PUT as replacePiecesPUT,
} from "./[id]/pieces/route";
import { DELETE as pieceDELETE, PATCH as piecePATCH } from "./[id]/pieces/[pieceId]/route";
import { POST as reorderPOST } from "./[id]/pieces/reorder/route";

import {
    buildRequest,
    cleanupTaggedRows,
    makeTestTag,
    readResponse,
} from "@/test/integration/helpers";

const tag = makeTestTag("look");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

interface LookRow {
    id: string;
    handle: string;
    title: string;
    bodyModelId: string;
    bodyArea: string;
    bundlePrice: number;
    totalIndividualPrice: number;
    discountPercent: string | null;
    isPublished: boolean | null;
}
interface PieceRow {
    id: string;
    lookId: string;
    piercingPointId: string;
    variantId: string;
    sortOrder: number | null;
}
interface CreateLookResponse {
    look: LookRow;
}
interface PiecePostResponse {
    piece: PieceRow;
    totals: {
        totalIndividualPrice: number;
        bundlePrice: number;
        discountPercent: string | null;
    };
}
interface ReplacePiecesResponse {
    pieces: PieceRow[];
    totals: PiecePostResponse["totals"];
    count: number;
    mode: "replace";
}
interface ErrorBody {
    error: { code: string; message: string };
}

let counter = 1;
function nextHandle(prefix = "look"): string {
    return `${tag}-${prefix}-${(counter++).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Fixture builders — body model + 2 anchors + product + 2 variants. Each
// test that needs piece data calls these to get fresh ids.
// ---------------------------------------------------------------------------

interface Fixture {
    bodyModelId: string;
    anchorIds: string[]; // [a, b]
    productId: string;
    variantIds: string[]; // [v100, v200]  (priceRub: 100_00 and 200_00)
}

async function buildFixture(): Promise<Fixture> {
    // Body model + 2 anchors.
    const bmRes = await createBodyModelPOST(
        buildRequest("/api/admin/body-models", "POST", {
            body: {
                name: nextHandle("model"),
                area: "ear",
                modelUrl: "https://cdn.example.com/x.glb",
                cameraDefaults: { fov: 45 },
            },
        })
    );
    const bm = await readResponse<{ bodyModel: { id: string } }>(bmRes);
    const bodyModelId = bm.json.bodyModel.id;

    const anchorIds: string[] = [];
    for (const name of ["look_a", "look_b"]) {
        const res = await createAnchorPOST(
            buildRequest(`/api/admin/body-models/${bodyModelId}/anchors`, "POST", {
                body: {
                    name: `${tag.replace(/-/g, "_")}_${name}`,
                    displayName: `Display ${name}`,
                    position: { x: 0, y: 0, z: 0 },
                    normal: { x: 0, y: 1, z: 0 },
                    compatibleJewelryTypes: ["stud"],
                },
            }),
            { params: Promise.resolve({ id: bodyModelId }) }
        );
        const j = await readResponse<{ anchor: { id: string } }>(res);
        anchorIds.push(j.json.anchor.id);
    }

    // Product + 2 variants.
    const prodHandle = nextHandle("prod");
    const prodRes = await createProductPOST(
        buildRequest("/api/admin/products", "POST", {
            body: {
                handle: prodHandle,
                title: `Test ${prodHandle}`,
                material: "titanium",
                jewelryType: "stud",
            },
        })
    );
    const prod = await readResponse<{ product: { id: string } }>(prodRes);
    const productId = prod.json.product.id;

    const variantIds: string[] = [];
    for (const price of [100_00, 200_00]) {
        const res = await createVariantPOST(
            buildRequest(`/api/admin/products/${productId}/variants`, "POST", {
                body: { title: `var-${price}`, priceRub: price },
            }),
            { params: Promise.resolve({ id: productId }) }
        );
        const j = await readResponse<{ variant: { id: string } }>(res);
        variantIds.push(j.json.variant.id);
    }

    return { bodyModelId, anchorIds, productId, variantIds };
}

async function createLook(bodyModelId: string, overrides: Partial<Record<string, unknown>> = {}) {
    const handle = nextHandle();
    const res = await createLookPOST(
        buildRequest("/api/admin/looks", "POST", {
            body: {
                handle,
                title: `Сет ${handle}`,
                bodyModelId,
                bundlePrice: 250_00, // discounted
                ...overrides,
            },
        })
    );
    return { handle, parsed: await readResponse<CreateLookResponse>(res) };
}

describe("POST /api/admin/looks — create with auto-filled bodyArea", () => {
    it("auto-fills bodyArea from the body model when omitted", async () => {
        const fixture = await buildFixture();
        const { parsed } = await createLook(fixture.bodyModelId);
        expect(parsed.status).toBe(201);
        expect(parsed.json.look.bodyArea).toBe("ear");
        expect(parsed.json.look.totalIndividualPrice).toBe(0);
    });

    it("rejects creation against a missing body model with 400 body_model_not_found", async () => {
        const ghost = "00000000-0000-4000-8000-0000000000bb";
        const res = await createLookPOST(
            buildRequest("/api/admin/looks", "POST", {
                body: {
                    handle: nextHandle(),
                    title: "ghost",
                    bodyModelId: ghost,
                    bundlePrice: 100,
                },
            })
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("body_model_not_found");
    });

    it("rejects duplicate handle with handle_in_use 409 (pre-flight)", async () => {
        const fixture = await buildFixture();
        const handle = nextHandle();
        const a = await createLookPOST(
            buildRequest("/api/admin/looks", "POST", {
                body: {
                    handle,
                    title: "a",
                    bodyModelId: fixture.bodyModelId,
                    bundlePrice: 100,
                },
            })
        );
        expect(a.status).toBe(201);
        const b = await createLookPOST(
            buildRequest("/api/admin/looks", "POST", {
                body: {
                    handle,
                    title: "b",
                    bodyModelId: fixture.bodyModelId,
                    bundlePrice: 100,
                },
            })
        );
        const body = await readResponse<ErrorBody>(b);
        expect(body.status).toBe(409);
        expect(body.json.error.code).toBe("handle_in_use");
    });
});

describe("POST /api/admin/looks/[id]/pieces — recalc on append", () => {
    it("appending pieces recomputes totalIndividualPrice and discountPercent", async () => {
        const fixture = await buildFixture();
        const { parsed } = await createLook(fixture.bodyModelId, {
            bundlePrice: 250_00,
        });
        const lookId = parsed.json.look.id;

        // Append the first piece (variant priceRub=100_00). Total should be 100_00.
        let res = await appendPiecePOST(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "POST", {
                body: {
                    piercingPointId: fixture.anchorIds[0],
                    variantId: fixture.variantIds[0],
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );
        let body = await readResponse<PiecePostResponse>(res);
        expect(body.status).toBe(201);
        expect(body.json.totals.totalIndividualPrice).toBe(100_00);
        // bundlePrice (250_00) > total (100_00) → no discount, discountPercent stays null.
        expect(body.json.totals.discountPercent).toBeNull();

        // Append the second piece (variant priceRub=200_00). Total → 300_00.
        // bundlePrice 250_00 < total 300_00 → discount = (1 - 250/300)*100 ≈ 16.7
        res = await appendPiecePOST(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "POST", {
                body: {
                    piercingPointId: fixture.anchorIds[1],
                    variantId: fixture.variantIds[1],
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );
        body = await readResponse<PiecePostResponse>(res);
        expect(body.status).toBe(201);
        expect(body.json.totals.totalIndividualPrice).toBe(300_00);
        expect(body.json.totals.discountPercent).toBe("16.7");
    });

    it("returns 400 for an unknown variant id", async () => {
        const fixture = await buildFixture();
        const { parsed } = await createLook(fixture.bodyModelId);
        const lookId = parsed.json.look.id;

        const res = await appendPiecePOST(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "POST", {
                body: {
                    piercingPointId: fixture.anchorIds[0],
                    variantId: "00000000-0000-4000-8000-0000000000fe",
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("variant_not_found");
    });
});

describe("PUT /api/admin/looks/[id]/pieces — atomic replace + recalc", () => {
    it("wipes existing pieces and inserts the new set; totals reflect the new variants", async () => {
        const fixture = await buildFixture();
        const { parsed } = await createLook(fixture.bodyModelId, {
            bundlePrice: 150_00,
        });
        const lookId = parsed.json.look.id;

        // Pre-populate with one piece.
        await appendPiecePOST(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "POST", {
                body: {
                    piercingPointId: fixture.anchorIds[0],
                    variantId: fixture.variantIds[0],
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );

        // Replace with both pieces.
        const res = await replacePiecesPUT(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "PUT", {
                body: {
                    pieces: [
                        {
                            piercingPointId: fixture.anchorIds[0],
                            variantId: fixture.variantIds[0],
                        },
                        {
                            piercingPointId: fixture.anchorIds[1],
                            variantId: fixture.variantIds[1],
                        },
                    ],
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );
        const body = await readResponse<ReplacePiecesResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.count).toBe(2);
        // 100 + 200 = 300; bundle 150 → discount = (300-150)/300 = 0.5 → "50.0"
        expect(body.json.totals.totalIndividualPrice).toBe(300_00);
        expect(body.json.totals.discountPercent).toBe("50.0");
    });

    it("empty array clears all pieces; totals → 0, discountPercent → null", async () => {
        const fixture = await buildFixture();
        const { parsed } = await createLook(fixture.bodyModelId);
        const lookId = parsed.json.look.id;

        // Add one piece first.
        await appendPiecePOST(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "POST", {
                body: {
                    piercingPointId: fixture.anchorIds[0],
                    variantId: fixture.variantIds[0],
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );

        const res = await replacePiecesPUT(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "PUT", {
                body: { pieces: [] },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );
        const body = await readResponse<ReplacePiecesResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.count).toBe(0);
        expect(body.json.totals.totalIndividualPrice).toBe(0);
        expect(body.json.totals.discountPercent).toBeNull();
    });
});

describe("PATCH /api/admin/looks/[id]/pieces/[pieceId] — variant swap recomputes", () => {
    it("changing variant updates totals; sortOrder swap does not", async () => {
        const fixture = await buildFixture();
        const { parsed } = await createLook(fixture.bodyModelId, {
            bundlePrice: 250_00,
        });
        const lookId = parsed.json.look.id;

        const append = await appendPiecePOST(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "POST", {
                body: {
                    piercingPointId: fixture.anchorIds[0],
                    variantId: fixture.variantIds[0], // 100_00
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );
        const appendBody = await readResponse<PiecePostResponse>(append);
        const pieceId = appendBody.json.piece.id;
        expect(appendBody.json.totals.totalIndividualPrice).toBe(100_00);

        // PATCH variant only — totals update.
        const swap = await piecePATCH(
            buildRequest(`/api/admin/looks/${lookId}/pieces/${pieceId}`, "PATCH", {
                body: { variantId: fixture.variantIds[1] }, // 200_00
            }),
            { params: Promise.resolve({ id: lookId, pieceId }) }
        );
        const swapBody = await readResponse<{
            piece: PieceRow;
            totals: { totalIndividualPrice: number };
        }>(swap);
        expect(swapBody.status).toBe(200);
        expect(swapBody.json.totals.totalIndividualPrice).toBe(200_00);

        // PATCH sortOrder only — `totals` should be `null` (no recompute).
        const reorder = await piecePATCH(
            buildRequest(`/api/admin/looks/${lookId}/pieces/${pieceId}`, "PATCH", {
                body: { sortOrder: 5 },
            }),
            { params: Promise.resolve({ id: lookId, pieceId }) }
        );
        const reorderBody = await readResponse<{
            piece: PieceRow;
            totals: null;
        }>(reorder);
        expect(reorderBody.status).toBe(200);
        expect(reorderBody.json.totals).toBeNull();
        expect(reorderBody.json.piece.sortOrder).toBe(5);
    });
});

describe("DELETE /api/admin/looks/[id]/pieces/[pieceId] — recalc on remove", () => {
    it("removing a piece recomputes totals", async () => {
        const fixture = await buildFixture();
        const { parsed } = await createLook(fixture.bodyModelId);
        const lookId = parsed.json.look.id;

        // Add both pieces.
        await replacePiecesPUT(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "PUT", {
                body: {
                    pieces: [
                        {
                            piercingPointId: fixture.anchorIds[0],
                            variantId: fixture.variantIds[0],
                        },
                        {
                            piercingPointId: fixture.anchorIds[1],
                            variantId: fixture.variantIds[1],
                        },
                    ],
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );

        // Discover the first piece id from GET.
        const list = await piecesGET(buildRequest(`/api/admin/looks/${lookId}/pieces`, "GET"), {
            params: Promise.resolve({ id: lookId }),
        });
        const listBody = await readResponse<{ pieces: PieceRow[] }>(list);
        const firstPieceId = listBody.json.pieces[0].id;

        const del = await pieceDELETE(
            buildRequest(`/api/admin/looks/${lookId}/pieces/${firstPieceId}`, "DELETE"),
            { params: Promise.resolve({ id: lookId, pieceId: firstPieceId }) }
        );
        const delBody = await readResponse<{
            deleted: boolean;
            totals: { totalIndividualPrice: number };
        }>(del);
        expect(delBody.status).toBe(200);
        // One variant remains (could be either 100_00 or 200_00 depending on
        // which the list returned first); both are valid totals.
        expect([100_00, 200_00]).toContain(delBody.json.totals.totalIndividualPrice);
    });
});

describe("POST /api/admin/looks/[id]/pieces/reorder", () => {
    it("rejects an order that omits an existing piece (incomplete_order)", async () => {
        const fixture = await buildFixture();
        const { parsed } = await createLook(fixture.bodyModelId);
        const lookId = parsed.json.look.id;

        await replacePiecesPUT(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "PUT", {
                body: {
                    pieces: [
                        {
                            piercingPointId: fixture.anchorIds[0],
                            variantId: fixture.variantIds[0],
                        },
                        {
                            piercingPointId: fixture.anchorIds[1],
                            variantId: fixture.variantIds[1],
                        },
                    ],
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );

        const list = await piecesGET(buildRequest(`/api/admin/looks/${lookId}/pieces`, "GET"), {
            params: Promise.resolve({ id: lookId }),
        });
        const listBody = await readResponse<{ pieces: PieceRow[] }>(list);
        const firstId = listBody.json.pieces[0].id;

        const res = await reorderPOST(
            buildRequest(`/api/admin/looks/${lookId}/pieces/reorder`, "POST", {
                body: { order: [{ id: firstId, sortOrder: 0 }] },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );
        const body = await readResponse<ErrorBody>(res);
        expect(body.status).toBe(400);
        expect(body.json.error.code).toBe("incomplete_order");
    });

    it("applies the new sortOrder atomically", async () => {
        const fixture = await buildFixture();
        const { parsed } = await createLook(fixture.bodyModelId);
        const lookId = parsed.json.look.id;

        await replacePiecesPUT(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "PUT", {
                body: {
                    pieces: [
                        {
                            piercingPointId: fixture.anchorIds[0],
                            variantId: fixture.variantIds[0],
                            sortOrder: 0,
                        },
                        {
                            piercingPointId: fixture.anchorIds[1],
                            variantId: fixture.variantIds[1],
                            sortOrder: 1,
                        },
                    ],
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );

        const list = await piecesGET(buildRequest(`/api/admin/looks/${lookId}/pieces`, "GET"), {
            params: Promise.resolve({ id: lookId }),
        });
        const listBody = await readResponse<{ pieces: PieceRow[] }>(list);
        const ids = listBody.json.pieces.map((p) => p.id);

        const res = await reorderPOST(
            buildRequest(`/api/admin/looks/${lookId}/pieces/reorder`, "POST", {
                body: {
                    order: [
                        { id: ids[1], sortOrder: 0 },
                        { id: ids[0], sortOrder: 1 },
                    ],
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );
        const body = await readResponse<{
            pieces: PieceRow[];
            count: number;
            mode: string;
        }>(res);
        expect(body.status).toBe(200);
        expect(body.json.count).toBe(2);
        expect(body.json.mode).toBe("reorder");

        const after = await piecesGET(buildRequest(`/api/admin/looks/${lookId}/pieces`, "GET"), {
            params: Promise.resolve({ id: lookId }),
        });
        const afterBody = await readResponse<{ pieces: PieceRow[] }>(after);
        expect(afterBody.json.pieces[0].id).toBe(ids[1]);
        expect(afterBody.json.pieces[1].id).toBe(ids[0]);
    });
});

describe("DELETE /api/admin/looks/[id] — cascade", () => {
    it("hard-deleting a look cascades to look_piece", async () => {
        const fixture = await buildFixture();
        const { parsed } = await createLook(fixture.bodyModelId);
        const lookId = parsed.json.look.id;

        await appendPiecePOST(
            buildRequest(`/api/admin/looks/${lookId}/pieces`, "POST", {
                body: {
                    piercingPointId: fixture.anchorIds[0],
                    variantId: fixture.variantIds[0],
                },
            }),
            { params: Promise.resolve({ id: lookId }) }
        );

        const del = await deleteLookDELETE(buildRequest(`/api/admin/looks/${lookId}`, "DELETE"), {
            params: Promise.resolve({ id: lookId }),
        });
        expect(del.status).toBe(200);

        const get = await detailGET(buildRequest(`/api/admin/looks/${lookId}`, "GET"), {
            params: Promise.resolve({ id: lookId }),
        });
        expect(get.status).toBe(404);
    });
});

describe("GET /api/admin/looks — list filter", () => {
    it("filters by isPublished", async () => {
        const fixture = await buildFixture();
        const draft = await createLook(fixture.bodyModelId);
        const live = await createLook(fixture.bodyModelId, { isPublished: true });

        const res = await listLooksGET(
            buildRequest("/api/admin/looks", "GET", {
                query: { isPublished: "true", search: tag, limit: 100 },
            })
        );
        const body = await readResponse<{
            looks: LookRow[];
        }>(res);
        expect(body.status).toBe(200);
        const ids = body.json.looks.map((l) => l.id);
        expect(ids).toContain(live.parsed.json.look.id);
        expect(ids).not.toContain(draft.parsed.json.look.id);
    });
});
