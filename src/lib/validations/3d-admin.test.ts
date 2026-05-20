/**
 * Validation contract tests for the 3D admin surface (body models, anchors,
 * jewelry models). Pure-zod tests — no DB, no fetch.
 */
import { describe, expect, it } from "vitest";

import {
    adminListBodyModelsQuerySchema,
    adminListJewelryModelsQuerySchema,
    anchorEditorPayloadSchema,
    anchorSchema,
    createBodyModelSchema,
    createJewelryModelSchema,
    replaceAnchorsSchema,
    updateBodyModelSchema,
} from "./content";

const validBodyModel = {
    name: "Левое ухо",
    area: "ear",
    modelUrl: "https://cdn.example.com/ear.glb",
    cameraDefaults: { position: [0, 0, 2], target: [0, 0, 0], fov: 45 },
} as const;

const validAnchor = {
    name: "helix_upper_1",
    displayName: "Helix Upper 1",
    position: { x: 0.12, y: 0.04, z: 0.01 },
    normal: { x: 0, y: 1, z: 0 },
    compatibleJewelryTypes: ["stud"],
} as const;

describe("createBodyModelSchema", () => {
    it("accepts a minimal valid payload", () => {
        const r = createBodyModelSchema.safeParse(validBodyModel);
        expect(r.success).toBe(true);
    });

    it("rejects unknown area shape (uppercase)", () => {
        const r = createBodyModelSchema.safeParse({ ...validBodyModel, area: "EAR" });
        expect(r.success).toBe(false);
    });

    it("rejects non-URL modelUrl", () => {
        const r = createBodyModelSchema.safeParse({
            ...validBodyModel,
            modelUrl: "not a url",
        });
        expect(r.success).toBe(false);
    });

    it("accepts side null / undefined / left / right", () => {
        for (const side of [null, undefined, "left", "right"]) {
            const r = createBodyModelSchema.safeParse({ ...validBodyModel, side });
            expect(r.success).toBe(true);
        }
    });

    it("rejects invalid side value", () => {
        const r = createBodyModelSchema.safeParse({ ...validBodyModel, side: "center" });
        expect(r.success).toBe(false);
    });

    it("caps skinTextures at 20 entries", () => {
        const r = createBodyModelSchema.safeParse({
            ...validBodyModel,
            skinTextures: Array.from({ length: 21 }, (_, i) => ({ tone: `t${i}` })),
        });
        expect(r.success).toBe(false);
    });
});

describe("updateBodyModelSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateBodyModelSchema.safeParse({}).success).toBe(true);
    });

    it("still validates the area shape on PATCH", () => {
        const r = updateBodyModelSchema.safeParse({ area: "BAD AREA" });
        expect(r.success).toBe(false);
    });
});

describe("adminListBodyModelsQuerySchema", () => {
    it("defaults includeInactive to false", () => {
        const r = adminListBodyModelsQuerySchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.includeInactive).toBe(false);
    });

    it("coerces string boolean for includeInactive", () => {
        const r = adminListBodyModelsQuerySchema.safeParse({ includeInactive: "true" });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.includeInactive).toBe(true);
    });

    it("recognises 'false' as false (not truthy non-empty string)", () => {
        // Guards against the z.coerce.boolean() pitfall where any non-empty
        // string becomes `true`. We use the strict queryBoolean helper.
        const r = adminListBodyModelsQuerySchema.safeParse({ includeInactive: "false" });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.includeInactive).toBe(false);
    });

    it("rejects junk strings instead of silently coercing", () => {
        const r = adminListBodyModelsQuerySchema.safeParse({ includeInactive: "yes" });
        expect(r.success).toBe(false);
    });
});

describe("anchorSchema", () => {
    it("accepts a valid anchor", () => {
        expect(anchorSchema.safeParse(validAnchor).success).toBe(true);
    });

    it.each([
        ["uppercase name", "Helix"],
        ["spaces", "helix upper"],
        ["dash", "helix-upper"],
        ["empty", ""],
    ])("rejects bad machine name: %s", (_label, name) => {
        const r = anchorSchema.safeParse({ ...validAnchor, name });
        expect(r.success).toBe(false);
    });

    it("requires at least one compatible jewelry type", () => {
        const r = anchorSchema.safeParse({ ...validAnchor, compatibleJewelryTypes: [] });
        expect(r.success).toBe(false);
    });

    it("coerces numeric strings on vector components", () => {
        const r = anchorSchema.safeParse({
            ...validAnchor,
            position: { x: "0.5", y: "1.0", z: "-0.2" },
        });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.position.x).toBe(0.5);
            expect(r.data.position.z).toBe(-0.2);
        }
    });
});

describe("replaceAnchorsSchema", () => {
    it("accepts an empty array (clears all anchors)", () => {
        const r = replaceAnchorsSchema.safeParse({ anchors: [] });
        expect(r.success).toBe(true);
    });

    it("accepts up to 200 anchors", () => {
        const big = Array.from({ length: 200 }, (_, i) => ({
            ...validAnchor,
            name: `helix_${i}`,
            displayName: `Helix ${i}`,
        }));
        expect(replaceAnchorsSchema.safeParse({ anchors: big }).success).toBe(true);
    });

    it("caps the array at 200", () => {
        const tooBig = Array.from({ length: 201 }, (_, i) => ({
            ...validAnchor,
            name: `helix_${i}`,
            displayName: `Helix ${i}`,
        }));
        expect(replaceAnchorsSchema.safeParse({ anchors: tooBig }).success).toBe(false);
    });
});

describe("anchorEditorPayloadSchema (legacy flat shape)", () => {
    it("accepts the anchor-editor.html export shape", () => {
        const payload = [
            {
                name: "helix_upper_1",
                display_name: "Helix Upper 1",
                body_area: "ear",
                position_x: 0.1,
                position_y: 0.2,
                position_z: 0.3,
                rotation_x: 0,
                rotation_y: 0,
                rotation_z: 0,
                normal_x: 0,
                normal_y: 1,
                normal_z: 0,
                compatible_jewelry_types: ["stud", "hoop"],
                compatible_gauges: ["18g", "16g"],
            },
        ];
        const r = anchorEditorPayloadSchema.safeParse(payload);
        expect(r.success).toBe(true);
    });

    it("accepts numeric strings (coercion path)", () => {
        const payload = [
            {
                name: "helix_1",
                position_x: "0.1",
                position_y: "0.2",
                position_z: "0.3",
                normal_x: "0",
                normal_y: "1",
                normal_z: "0",
                compatible_jewelry_types: ["stud"],
            },
        ];
        expect(anchorEditorPayloadSchema.safeParse(payload).success).toBe(true);
    });

    it("rejects when required vector components are missing", () => {
        const r = anchorEditorPayloadSchema.safeParse([
            {
                name: "helix_1",
                position_x: 0.1,
                position_y: 0.2,
                // missing position_z
                normal_x: 0,
                normal_y: 1,
                normal_z: 0,
                compatible_jewelry_types: ["stud"],
            },
        ]);
        expect(r.success).toBe(false);
    });
});

describe("createJewelryModelSchema", () => {
    const validJewelry = {
        productId: "5b2e3c1a-9d4f-4e2b-8a7c-1f2e3d4c5b6a",
        modelUrl: "https://cdn.example.com/stud.glb",
        jewelryType: "stud",
    };

    it("accepts a minimal valid payload", () => {
        expect(createJewelryModelSchema.safeParse(validJewelry).success).toBe(true);
    });

    it("requires productId to be a UUID", () => {
        const r = createJewelryModelSchema.safeParse({
            ...validJewelry,
            productId: "not-a-uuid",
        });
        expect(r.success).toBe(false);
    });

    it("rejects invalid status enum", () => {
        const r = createJewelryModelSchema.safeParse({
            ...validJewelry,
            status: "trashed",
        });
        expect(r.success).toBe(false);
    });
});

describe("adminListJewelryModelsQuerySchema", () => {
    it.each([
        ["true → true", "true", true],
        ["false → false (not truthy non-empty)", "false", false],
    ])("queryBoolean isValidated: %s", (_label, raw, expected) => {
        const r = adminListJewelryModelsQuerySchema.safeParse({ isValidated: raw });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.isValidated).toBe(expected);
    });

    it("rejects junk boolean strings on isValidated", () => {
        const r = adminListJewelryModelsQuerySchema.safeParse({ isValidated: "1" });
        expect(r.success).toBe(false);
    });

    it("accepts pagination defaults", () => {
        const r = adminListJewelryModelsQuerySchema.safeParse({});
        expect(r.success).toBe(true);
    });
});
