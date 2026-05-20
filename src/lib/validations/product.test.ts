/**
 * Validation contract tests for the admin product write surface.
 *
 * These pin the shape that `/api/admin/products`, `/variants`, `/media`,
 * and `/piercing-areas` rely on. Pure-zod tests — no DB, no fetch. Slower
 * integration tests against the seeded catalogue should live under e2e/.
 */
import { describe, expect, it } from "vitest";

import {
    adminListProductsQuerySchema,
    attachProductMediaSchema,
    createProductSchema,
    createVariantSchema,
    reorderProductMediaSchema,
    replacePiercingAreasSchema,
    updateProductMediaSchema,
    updateProductSchema,
    updateVariantSchema,
} from "./product";

const validBaseProduct = {
    handle: "titanium-stud-cz-3mm",
    title: "Титановая серьга",
    material: "titanium",
    jewelryType: "stud",
} as const;

describe("createProductSchema", () => {
    it("accepts a minimal valid payload and applies defaults", () => {
        const r = createProductSchema.safeParse(validBaseProduct);
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.status).toBe("draft");
            expect(r.data.isFeatured).toBe(false);
            expect(r.data.has3dModel).toBe(false);
        }
    });

    it.each([
        ["leading dash", "-foo"],
        ["trailing dash", "foo-"],
        ["uppercase", "Foo-Bar"],
        ["spaces", "foo bar"],
        ["unicode", "украшение"],
        ["consecutive dashes", "foo--bar"],
    ])("rejects bad slug shape: %s", (_label, handle) => {
        const r = createProductSchema.safeParse({ ...validBaseProduct, handle });
        expect(r.success).toBe(false);
    });

    it("rejects unknown material values", () => {
        const r = createProductSchema.safeParse({
            ...validBaseProduct,
            material: "bronze",
        });
        expect(r.success).toBe(false);
    });

    it("rejects unknown jewelryType values", () => {
        const r = createProductSchema.safeParse({
            ...validBaseProduct,
            jewelryType: "shoelace",
        });
        expect(r.success).toBe(false);
    });

    it("accepts an empty piercingAreas array (clears existing)", () => {
        const r = createProductSchema.safeParse({
            ...validBaseProduct,
            piercingAreas: [],
        });
        expect(r.success).toBe(true);
    });

    it("rejects unknown piercingArea enum values", () => {
        const r = createProductSchema.safeParse({
            ...validBaseProduct,
            piercingAreas: ["ear_lobe", "elbow"],
        });
        expect(r.success).toBe(false);
    });

    it("allows null on optional nullable strings", () => {
        const r = createProductSchema.safeParse({
            ...validBaseProduct,
            description: null,
            thumbnailUrl: null,
        });
        expect(r.success).toBe(true);
    });

    it("requires URLs on thumbnailUrl / ogImageUrl", () => {
        const r = createProductSchema.safeParse({
            ...validBaseProduct,
            thumbnailUrl: "not a url",
        });
        expect(r.success).toBe(false);
    });
});

describe("updateProductSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateProductSchema.safeParse({}).success).toBe(true);
    });

    it("accepts a single-field patch", () => {
        const r = updateProductSchema.safeParse({ isFeatured: true });
        expect(r.success).toBe(true);
    });

    it("still validates the slug shape on PATCH", () => {
        const r = updateProductSchema.safeParse({ handle: "BAD HANDLE" });
        expect(r.success).toBe(false);
    });
});

describe("adminListProductsQuerySchema", () => {
    it("coerces string booleans for includeDeleted", () => {
        const r = adminListProductsQuerySchema.safeParse({ includeDeleted: "true" });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.includeDeleted).toBe(true);
    });

    it("defaults sort to newest", () => {
        const r = adminListProductsQuerySchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.sort).toBe("newest");
    });

    it("rejects invalid status values", () => {
        const r = adminListProductsQuerySchema.safeParse({ status: "trashed" });
        expect(r.success).toBe(false);
    });
});

describe("createVariantSchema", () => {
    it("coerces string priceRub to integer kopecks", () => {
        const r = createVariantSchema.safeParse({
            title: "20G, длина 6 мм",
            priceRub: "120000",
        });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.priceRub).toBe(120_000);
    });

    it("applies inventory defaults", () => {
        const r = createVariantSchema.safeParse({ title: "Default", priceRub: 100 });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.manageInventory).toBe(true);
            expect(r.data.inventoryQuantity).toBe(0);
            expect(r.data.lowStockThreshold).toBe(3);
            expect(r.data.allowBackorder).toBe(false);
            expect(r.data.sortOrder).toBe(0);
        }
    });

    it("rejects negative price", () => {
        const r = createVariantSchema.safeParse({ title: "Bad", priceRub: -1 });
        expect(r.success).toBe(false);
    });

    it("coerces lengthMm/diameterMm strings to numbers", () => {
        const r = createVariantSchema.safeParse({
            title: "Numeric",
            priceRub: 100,
            lengthMm: "8.0",
            diameterMm: "10.5",
        });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.lengthMm).toBe(8);
            expect(r.data.diameterMm).toBe(10.5);
        }
    });

    it("rejects priceRub that's not an integer", () => {
        const r = createVariantSchema.safeParse({ title: "Frac", priceRub: 99.5 });
        expect(r.success).toBe(false);
    });
});

describe("updateVariantSchema", () => {
    it("accepts empty patch", () => {
        expect(updateVariantSchema.safeParse({}).success).toBe(true);
    });

    it("accepts updating just inventory", () => {
        const r = updateVariantSchema.safeParse({ inventoryQuantity: 50 });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.inventoryQuantity).toBe(50);
    });
});

describe("replacePiercingAreasSchema", () => {
    it("accepts a valid set", () => {
        const r = replacePiercingAreasSchema.safeParse({
            areas: ["ear_lobe", "ear_helix"],
        });
        expect(r.success).toBe(true);
    });

    it("accepts an empty set (clears all)", () => {
        const r = replacePiercingAreasSchema.safeParse({ areas: [] });
        expect(r.success).toBe(true);
    });

    it("rejects unknown area values", () => {
        const r = replacePiercingAreasSchema.safeParse({
            areas: ["ear_lobe", "knee"],
        });
        expect(r.success).toBe(false);
    });

    it("caps the array length at 50", () => {
        const r = replacePiercingAreasSchema.safeParse({
            areas: Array.from({ length: 51 }, () => "ear_lobe"),
        });
        expect(r.success).toBe(false);
    });
});

describe("attachProductMediaSchema", () => {
    it("applies media defaults", () => {
        const r = attachProductMediaSchema.safeParse({
            url: "https://cdn.example.com/p.webp",
        });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.kind).toBe("image");
            expect(r.data.isPrimary).toBe(false);
            expect(r.data.sortOrder).toBe(0);
        }
    });

    it("rejects non-URL", () => {
        const r = attachProductMediaSchema.safeParse({ url: "not a url" });
        expect(r.success).toBe(false);
    });

    it("rejects unknown kind", () => {
        const r = attachProductMediaSchema.safeParse({
            url: "https://cdn.example.com/p.webp",
            kind: "audio",
        });
        expect(r.success).toBe(false);
    });

    it("rejects non-uuid variantId", () => {
        const r = attachProductMediaSchema.safeParse({
            url: "https://cdn.example.com/p.webp",
            variantId: "not-a-uuid",
        });
        expect(r.success).toBe(false);
    });
});

describe("updateProductMediaSchema", () => {
    it("accepts empty patch", () => {
        expect(updateProductMediaSchema.safeParse({}).success).toBe(true);
    });

    it("accepts isPrimary toggle", () => {
        const r = updateProductMediaSchema.safeParse({ isPrimary: true });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.isPrimary).toBe(true);
    });
});

describe("reorderProductMediaSchema", () => {
    it("accepts a non-empty list of UUIDs", () => {
        const r = reorderProductMediaSchema.safeParse({
            ordering: [
                "5b2e3c1a-9d4f-4e2b-8a7c-1f2e3d4c5b6a",
                "7f8e9d0c-1b2a-4d3e-9f8c-7a6b5c4d3e2f",
            ],
        });
        expect(r.success).toBe(true);
    });

    it("rejects empty ordering", () => {
        const r = reorderProductMediaSchema.safeParse({ ordering: [] });
        expect(r.success).toBe(false);
    });

    it("rejects non-UUID ids", () => {
        const r = reorderProductMediaSchema.safeParse({ ordering: ["abc"] });
        expect(r.success).toBe(false);
    });

    it("caps the list at 50 entries", () => {
        // Generate RFC 4122 v4 UUIDs so the length cap is the failure mode,
        // not the regex.
        const r = reorderProductMediaSchema.safeParse({
            ordering: Array.from({ length: 51 }, () => crypto.randomUUID()),
        });
        expect(r.success).toBe(false);
    });
});
