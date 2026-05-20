import { describe, expect, it } from "vitest";

import {
    chunk,
    dedupeAudience,
    productUrl,
    MATERIAL_LABELS_RU,
    JEWELRY_TYPE_LABELS_RU,
} from "./new-arrival.utils";

describe("new-arrival utils — dedupeAudience", () => {
    it("returns wishlist audience first when overlapping", () => {
        const out = dedupeAudience(
            [{ customerId: "a" }, { customerId: "b" }],
            [{ customerId: "b" }, { customerId: "c" }]
        );
        expect(out).toEqual([
            { customerId: "a", audience: "wishlist" },
            { customerId: "b", audience: "wishlist" },
            { customerId: "c", audience: "marketing" },
        ]);
    });

    it("filters out empty customerIds", () => {
        const out = dedupeAudience(
            [{ customerId: "" }, { customerId: "a" }],
            [{ customerId: "" as string }, { customerId: "b" }]
        );
        expect(out.map((r) => r.customerId)).toEqual(["a", "b"]);
    });

    it("preserves wishlist insertion order", () => {
        const out = dedupeAudience(
            [{ customerId: "z" }, { customerId: "y" }, { customerId: "x" }],
            []
        );
        expect(out.map((r) => r.customerId)).toEqual(["z", "y", "x"]);
    });

    it("returns empty array when both pools empty", () => {
        expect(dedupeAudience([], [])).toEqual([]);
    });
});

describe("new-arrival utils — chunk", () => {
    it("splits into fixed-size chunks", () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    });

    it("returns single chunk if size >= length", () => {
        expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
    });

    it("returns empty array on empty input", () => {
        expect(chunk([], 5)).toEqual([]);
    });

    it("falls back to single chunk on size <= 0", () => {
        expect(chunk([1, 2], 0)).toEqual([[1, 2]]);
    });
});

describe("new-arrival utils — productUrl", () => {
    it("joins origin and handle without double slashes", () => {
        expect(productUrl("https://piercerkzn.ru/", "gold-stud")).toBe(
            "https://piercerkzn.ru/jewelry/gold-stud"
        );
    });

    it("encodes special characters in handle", () => {
        expect(productUrl("https://piercerkzn.ru", "ring/with space")).toBe(
            "https://piercerkzn.ru/jewelry/ring%2Fwith%20space"
        );
    });
});

describe("new-arrival utils — labels", () => {
    it("maps known materials and types to Russian", () => {
        expect(MATERIAL_LABELS_RU.titanium).toBe("титан");
        expect(MATERIAL_LABELS_RU.gold_14k).toBe("золото 14к");
        expect(JEWELRY_TYPE_LABELS_RU.stud).toBe("гвоздик");
        expect(JEWELRY_TYPE_LABELS_RU.hoop).toBe("кольцо");
    });
});
