/**
 * Validation contract tests for the content admin surface (blog + aftercare).
 */
import { describe, expect, it } from "vitest";

import {
    adminListAftercareQuerySchema,
    adminListBlogPostsQuerySchema,
    createAftercareGuideSchema,
    createBlogCategorySchema,
    createBlogPostSchema,
    updateAftercareGuideSchema,
    updateBlogCategorySchema,
    updateBlogPostSchema,
} from "./content";

// ---------------------------------------------------------------------------
// Blog categories
// ---------------------------------------------------------------------------
describe("createBlogCategorySchema", () => {
    it("accepts a valid payload", () => {
        const r = createBlogCategorySchema.safeParse({
            handle: "piercing-tips",
            name: "Советы пирсера",
            sortOrder: 1,
        });
        expect(r.success).toBe(true);
    });

    it.each([
        ["uppercase", "Tips"],
        ["spaces", "tips and tricks"],
        ["leading dash", "-tips"],
        ["unicode", "советы"],
    ])("rejects bad handle: %s", (_label, handle) => {
        const r = createBlogCategorySchema.safeParse({ handle, name: "X" });
        expect(r.success).toBe(false);
    });

    it("requires non-empty name", () => {
        const r = createBlogCategorySchema.safeParse({ handle: "ok", name: "" });
        expect(r.success).toBe(false);
    });
});

describe("updateBlogCategorySchema", () => {
    it("accepts an empty patch", () => {
        expect(updateBlogCategorySchema.safeParse({}).success).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Blog posts
// ---------------------------------------------------------------------------
const validBlogPost = {
    slug: "first-piercing-aftercare",
    title: "Уход за первым пирсингом",
    content: "Markdown content here…",
} as const;

describe("createBlogPostSchema", () => {
    it("accepts a minimal payload and defaults status to draft", () => {
        const r = createBlogPostSchema.safeParse(validBlogPost);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.status).toBe("draft");
    });

    it("rejects empty content", () => {
        const r = createBlogPostSchema.safeParse({ ...validBlogPost, content: "" });
        expect(r.success).toBe(false);
    });

    it("rejects bad slug shape", () => {
        const r = createBlogPostSchema.safeParse({ ...validBlogPost, slug: "Bad Slug" });
        expect(r.success).toBe(false);
    });

    it("rejects unknown status", () => {
        const r = createBlogPostSchema.safeParse({
            ...validBlogPost,
            status: "trashed",
        });
        expect(r.success).toBe(false);
    });

    it("coerces ISO scheduledAt strings to Date", () => {
        const r = createBlogPostSchema.safeParse({
            ...validBlogPost,
            scheduledAt: "2030-01-01T12:00:00Z",
        });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.scheduledAt).toBeInstanceOf(Date);
    });

    it("caps tags at 20 entries", () => {
        const r = createBlogPostSchema.safeParse({
            ...validBlogPost,
            tags: Array.from({ length: 21 }, (_v, i) => `tag${i}`),
        });
        expect(r.success).toBe(false);
    });
});

describe("updateBlogPostSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateBlogPostSchema.safeParse({}).success).toBe(true);
    });

    it("still validates slug shape on PATCH", () => {
        const r = updateBlogPostSchema.safeParse({ slug: "BAD" });
        expect(r.success).toBe(false);
    });
});

describe("adminListBlogPostsQuerySchema", () => {
    it("defaults sort to newest", () => {
        const r = adminListBlogPostsQuerySchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.sort).toBe("newest");
    });

    it("accepts the scheduled sort", () => {
        const r = adminListBlogPostsQuerySchema.safeParse({ sort: "scheduled" });
        expect(r.success).toBe(true);
    });

    it("rejects unknown status filter", () => {
        const r = adminListBlogPostsQuerySchema.safeParse({ status: "trashed" });
        expect(r.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Aftercare
// ---------------------------------------------------------------------------
const validGuide = {
    handle: "helix",
    title: "Уход за хеликсом",
    piercingType: "ear_helix",
    content: { overview: "Очищайте 2 раза в день…" },
} as const;

describe("createAftercareGuideSchema", () => {
    it("accepts a minimal payload", () => {
        expect(createAftercareGuideSchema.safeParse(validGuide).success).toBe(true);
    });

    it("rejects bad handle (uppercase)", () => {
        const r = createAftercareGuideSchema.safeParse({ ...validGuide, handle: "Helix" });
        expect(r.success).toBe(false);
    });

    it("rejects bad piercingType (dash not allowed)", () => {
        const r = createAftercareGuideSchema.safeParse({
            ...validGuide,
            piercingType: "ear-helix",
        });
        expect(r.success).toBe(false);
    });

    it("requires content to be an object", () => {
        const r = createAftercareGuideSchema.safeParse({
            ...validGuide,
            content: "plain string",
        });
        expect(r.success).toBe(false);
    });

    it("caps healing weeks at 520 (10 years)", () => {
        const r = createAftercareGuideSchema.safeParse({
            ...validGuide,
            healingMinWeeks: 1,
            healingMaxWeeks: 521,
        });
        expect(r.success).toBe(false);
    });
});

describe("updateAftercareGuideSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateAftercareGuideSchema.safeParse({}).success).toBe(true);
    });
});

describe("adminListAftercareQuerySchema", () => {
    it("treats 'true'/'false' strictly via queryBoolean", () => {
        const t = adminListAftercareQuerySchema.safeParse({ isPublished: "true" });
        const f = adminListAftercareQuerySchema.safeParse({ isPublished: "false" });
        expect(t.success).toBe(true);
        expect(f.success).toBe(true);
        if (t.success) expect(t.data.isPublished).toBe(true);
        if (f.success) expect(f.data.isPublished).toBe(false);
    });

    it("rejects junk strings on isPublished", () => {
        const r = adminListAftercareQuerySchema.safeParse({ isPublished: "yes" });
        expect(r.success).toBe(false);
    });
});
