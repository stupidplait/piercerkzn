import { describe, expect, it } from "vitest";

import { IMAGE_VARIANTS, deriveVariantKey } from "./process.utils";

describe("media/process — deriveVariantKey", () => {
    it("appends .{suffix}.webp before the original extension", () => {
        expect(deriveVariantKey("products/2026/05/abc.jpg", "thumb")).toBe(
            "products/2026/05/abc.thumb.webp"
        );
        expect(deriveVariantKey("blog/2026/05/post.png", "og")).toBe("blog/2026/05/post.og.webp");
    });

    it("handles keys without an extension", () => {
        expect(deriveVariantKey("portfolio/2026/05/raw", "large")).toBe(
            "portfolio/2026/05/raw.large.webp"
        );
    });

    it("only strips the last dot in the key", () => {
        expect(deriveVariantKey("reviews/2026/05/v1.2.jpg", "thumb")).toBe(
            "reviews/2026/05/v1.2.thumb.webp"
        );
    });
});

describe("media/process — IMAGE_VARIANTS", () => {
    it("includes thumb / large / og specs", () => {
        expect(IMAGE_VARIANTS.map((v) => v.suffix)).toEqual(["thumb", "large", "og"]);
    });

    it("og variant uses cover fit with 1200x630", () => {
        const og = IMAGE_VARIANTS.find((v) => v.suffix === "og");
        expect(og?.fit).toBe("cover");
        expect(og?.width).toBe(1200);
        expect(og?.height).toBe(630);
    });
});
