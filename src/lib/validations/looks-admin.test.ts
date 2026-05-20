/**
 * Validation contract tests for the looks admin surface.
 */
import { describe, expect, it } from "vitest";

import {
    adminListCuratedLooksQuerySchema,
    createCuratedLookSchema,
    lookPieceSchema,
    reorderLookPiecesSchema,
    replaceLookPiecesSchema,
    updateCuratedLookSchema,
    updateLookPieceSchema,
} from "./content";

const u = (n = 1) => `5b2e3c1a-9d4f-4e2b-8a7c-1f2e3d4c5b${n.toString().padStart(2, "0")}`;

const validLook = {
    handle: "everyday-essentials",
    title: "Базовый сет",
    bodyModelId: u(1),
    bundlePrice: 12_000_00,
} as const;

describe("createCuratedLookSchema", () => {
    it("accepts a minimal valid payload", () => {
        const r = createCuratedLookSchema.safeParse(validLook);
        expect(r.success).toBe(true);
    });

    it.each([
        ["uppercase", "Looks"],
        ["spaces", "look one"],
        ["leading dash", "-look"],
    ])("rejects bad handle: %s", (_label, handle) => {
        const r = createCuratedLookSchema.safeParse({ ...validLook, handle });
        expect(r.success).toBe(false);
    });

    it("requires bundlePrice >= 0", () => {
        const r = createCuratedLookSchema.safeParse({ ...validLook, bundlePrice: -1 });
        expect(r.success).toBe(false);
    });

    it("normalises currencyCode to lowercase length 3", () => {
        const r = createCuratedLookSchema.safeParse({ ...validLook, currencyCode: "RUB" });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.currencyCode).toBe("rub");
    });

    it("rejects malformed cameraState", () => {
        const r = createCuratedLookSchema.safeParse({
            ...validLook,
            cameraState: { position: [0, 0], target: [0, 0, 0] },
        });
        expect(r.success).toBe(false);
    });

    it("accepts well-formed cameraState", () => {
        const r = createCuratedLookSchema.safeParse({
            ...validLook,
            cameraState: { position: [0, 1.65, 0.5], target: [0, 1.65, 0] },
        });
        expect(r.success).toBe(true);
    });

    it("rejects bad bodyArea regex", () => {
        const r = createCuratedLookSchema.safeParse({ ...validLook, bodyArea: "Ear" });
        expect(r.success).toBe(false);
    });
});

describe("updateCuratedLookSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateCuratedLookSchema.safeParse({}).success).toBe(true);
    });
});

describe("adminListCuratedLooksQuerySchema", () => {
    it("defaults sort to sortOrder", () => {
        const r = adminListCuratedLooksQuerySchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.sort).toBe("sortOrder");
    });

    it("accepts the discount sort", () => {
        const r = adminListCuratedLooksQuerySchema.safeParse({ sort: "discount" });
        expect(r.success).toBe(true);
    });

    it("rejects junk isPublished string", () => {
        const r = adminListCuratedLooksQuerySchema.safeParse({ isPublished: "yes" });
        expect(r.success).toBe(false);
    });
});

describe("lookPieceSchema", () => {
    const validPiece = { piercingPointId: u(2), variantId: u(3) };

    it("accepts minimal valid piece", () => {
        expect(lookPieceSchema.safeParse(validPiece).success).toBe(true);
    });

    it("requires UUID for both refs", () => {
        const r = lookPieceSchema.safeParse({ ...validPiece, variantId: "nope" });
        expect(r.success).toBe(false);
    });
});

describe("updateLookPieceSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateLookPieceSchema.safeParse({}).success).toBe(true);
    });
});

describe("replaceLookPiecesSchema", () => {
    it("accepts empty pieces (clears the look)", () => {
        expect(replaceLookPiecesSchema.safeParse({ pieces: [] }).success).toBe(true);
    });

    it("caps pieces at 50", () => {
        const big = Array.from({ length: 51 }, (_, i) => ({
            piercingPointId: u(i),
            variantId: u(i + 50),
        }));
        expect(replaceLookPiecesSchema.safeParse({ pieces: big }).success).toBe(false);
    });
});

describe("reorderLookPiecesSchema", () => {
    it("requires at least one entry", () => {
        const r = reorderLookPiecesSchema.safeParse({ order: [] });
        expect(r.success).toBe(false);
    });

    it("requires non-negative sortOrder", () => {
        const r = reorderLookPiecesSchema.safeParse({
            order: [{ id: u(1), sortOrder: -1 }],
        });
        expect(r.success).toBe(false);
    });

    it("accepts a valid permutation shape", () => {
        const r = reorderLookPiecesSchema.safeParse({
            order: [
                { id: u(1), sortOrder: 0 },
                { id: u(2), sortOrder: 1 },
            ],
        });
        expect(r.success).toBe(true);
    });
});
