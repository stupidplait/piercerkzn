/**
 * Validation schemas for content-driven endpoints (blog, aftercare,
 * curated looks, 3D assets).
 */
import { z } from "zod";
import { paginationSchema, queryBoolean, uuidSchema } from "./common";

// ---------------------------------------------------------------------------
// Blog
// ---------------------------------------------------------------------------
export const listBlogQuerySchema = paginationSchema.extend({
    category: z.string().trim().min(1).max(50).optional(),
    tag: z.string().trim().min(1).max(50).optional(),
    sort: z.enum(["newest", "oldest", "popular"]).default("newest"),
});
export type ListBlogQuery = z.infer<typeof listBlogQuerySchema>;

// ---------------------------------------------------------------------------
// Aftercare
// ---------------------------------------------------------------------------
export const listAftercareQuerySchema = z.object({
    piercingType: z
        .string()
        .trim()
        .min(1)
        .max(50)
        .regex(/^[a-z_]+$/u)
        .optional(),
});
export type ListAftercareQuery = z.infer<typeof listAftercareQuerySchema>;

// ---------------------------------------------------------------------------
// Curated Looks
// ---------------------------------------------------------------------------
export const listLooksQuerySchema = paginationSchema.extend({
    bodyArea: z
        .string()
        .trim()
        .min(1)
        .max(30)
        .regex(/^[a-z_]+$/u)
        .optional(),
});
export type ListLooksQuery = z.infer<typeof listLooksQuerySchema>;

// ---------------------------------------------------------------------------
// Shared primitives used by multiple admin schemas below.
// ---------------------------------------------------------------------------

/** Anatomical region tag — lowercase snake_case, capped to 30 chars. */
const bodyAreaSchema = z
    .string()
    .trim()
    .min(1)
    .max(30)
    .regex(/^[a-z_]+$/u, "Используйте латиницу в нижнем регистре и подчёркивания");

// ---------------------------------------------------------------------------
// Blog admin
// ---------------------------------------------------------------------------

/** Slug pattern: lowercase alphanumerics + dashes (matches storefront URLs). */
const blogSlugSchema = z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Слаг: латиница, цифры и дефис");

const blogCategoryHandleSchema = z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Слаг: латиница, цифры и дефис");

export const blogStatuses = ["draft", "published", "archived"] as const;

export const adminListBlogPostsQuerySchema = paginationSchema.extend({
    status: z.enum(blogStatuses).optional(),
    categoryId: uuidSchema.optional(),
    tag: z.string().trim().min(1).max(50).optional(),
    search: z.string().trim().max(200).optional(),
    sort: z.enum(["newest", "oldest", "popular", "scheduled"]).default("newest"),
});
export type AdminListBlogPostsQuery = z.infer<typeof adminListBlogPostsQuerySchema>;

export const createBlogCategorySchema = z.object({
    handle: blogCategoryHandleSchema,
    name: z.string().trim().min(1).max(100),
    sortOrder: z.coerce.number().int().optional(),
});
export type CreateBlogCategoryInput = z.infer<typeof createBlogCategorySchema>;

export const updateBlogCategorySchema = createBlogCategorySchema.partial();
export type UpdateBlogCategoryInput = z.infer<typeof updateBlogCategorySchema>;

export const createBlogPostSchema = z.object({
    slug: blogSlugSchema,
    title: z.string().trim().min(1).max(500),
    excerpt: z.string().trim().max(1_000).nullable().optional(),
    /** Markdown source or Lexical JSON. We don't validate the dialect here. */
    content: z.string().min(1),
    featuredImage: z.string().url().max(512).nullable().optional(),
    categoryId: uuidSchema.nullable().optional(),
    authorId: uuidSchema.nullable().optional(),
    status: z.enum(blogStatuses).default("draft"),
    /** When set in the future, the post is auto-published by a sweeper. */
    scheduledAt: z.coerce.date().nullable().optional(),
    readTimeMin: z.coerce.number().int().min(0).max(999).nullable().optional(),
    metaTitle: z.string().trim().max(200).nullable().optional(),
    metaDescription: z.string().trim().max(500).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});
export type CreateBlogPostInput = z.infer<typeof createBlogPostSchema>;

/**
 * Patch shape — defined directly so absent fields stay absent and don't
 * silently inject `status: "draft"` (zod v4 preserves `.default()` through
 * `.partial()`, which would otherwise reset every published post on edit).
 */
export const updateBlogPostSchema = z.object({
    slug: blogSlugSchema.optional(),
    title: z.string().trim().min(1).max(500).optional(),
    excerpt: z.string().trim().max(1_000).nullable().optional(),
    content: z.string().min(1).optional(),
    featuredImage: z.string().url().max(512).nullable().optional(),
    categoryId: uuidSchema.nullable().optional(),
    authorId: uuidSchema.nullable().optional(),
    status: z.enum(blogStatuses).optional(),
    scheduledAt: z.coerce.date().nullable().optional(),
    readTimeMin: z.coerce.number().int().min(0).max(999).nullable().optional(),
    metaTitle: z.string().trim().max(200).nullable().optional(),
    metaDescription: z.string().trim().max(500).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});
export type UpdateBlogPostInput = z.infer<typeof updateBlogPostSchema>;

// ---------------------------------------------------------------------------
// Curated looks admin
// ---------------------------------------------------------------------------

const lookHandleSchema = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Слаг: латиница, цифры и дефис");

const cameraStateSchema = z
    .object({
        position: z.tuple([z.coerce.number(), z.coerce.number(), z.coerce.number()]),
        target: z.tuple([z.coerce.number(), z.coerce.number(), z.coerce.number()]),
    })
    .strict();

export const adminListCuratedLooksQuerySchema = paginationSchema.extend({
    bodyArea: bodyAreaSchema.optional(),
    bodyModelId: uuidSchema.optional(),
    isPublished: queryBoolean.optional(),
    search: z.string().trim().max(200).optional(),
    sort: z.enum(["sortOrder", "newest", "oldest", "discount"]).default("sortOrder"),
});
export type AdminListCuratedLooksQuery = z.infer<typeof adminListCuratedLooksQuerySchema>;

export const createCuratedLookSchema = z.object({
    handle: lookHandleSchema,
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2_000).nullable().optional(),
    bodyModelId: uuidSchema,
    /** When omitted, the route handler auto-fills from the body model's `area`. */
    bodyArea: bodyAreaSchema.optional(),
    thumbnailUrl: z.string().url().max(512).nullable().optional(),
    /** Discounted bundle price in kopecks. Required. */
    bundlePrice: z.coerce.number().int().min(0),
    /**
     * Optional override for the sum-of-pieces total. When omitted, the handler
     * computes it from the current piece set (0 for a brand-new look until
     * pieces are attached).
     */
    totalIndividualPrice: z.coerce.number().int().min(0).optional(),
    currencyCode: z.string().trim().toLowerCase().length(3).optional(),
    cameraState: cameraStateSchema.nullable().optional(),
    isPublished: z.boolean().optional(),
    sortOrder: z.coerce.number().int().optional(),
});
export type CreateCuratedLookInput = z.infer<typeof createCuratedLookSchema>;

export const updateCuratedLookSchema = createCuratedLookSchema.partial();
export type UpdateCuratedLookInput = z.infer<typeof updateCuratedLookSchema>;

export const lookPieceSchema = z.object({
    piercingPointId: uuidSchema,
    variantId: uuidSchema,
    sortOrder: z.coerce.number().int().optional(),
});
export type LookPieceInput = z.infer<typeof lookPieceSchema>;

export const updateLookPieceSchema = lookPieceSchema.partial();
export type UpdateLookPieceInput = z.infer<typeof updateLookPieceSchema>;

export const replaceLookPiecesSchema = z.object({
    pieces: z.array(lookPieceSchema).max(50),
});
export type ReplaceLookPiecesInput = z.infer<typeof replaceLookPiecesSchema>;

export const reorderLookPiecesSchema = z.object({
    /** Array of `{ id, sortOrder }`. Must be a permutation of the look's pieces. */
    order: z
        .array(
            z.object({
                id: uuidSchema,
                sortOrder: z.coerce.number().int().min(0),
            })
        )
        .min(1)
        .max(50),
});
export type ReorderLookPiecesInput = z.infer<typeof reorderLookPiecesSchema>;

// ---------------------------------------------------------------------------
// Aftercare admin
// ---------------------------------------------------------------------------

const aftercareHandleSchema = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Слаг: латиница, цифры и дефис");

const piercingTypeSchema = z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9_]+$/u, "Машинное имя: латиница, цифры, подчёркивание");

export const adminListAftercareQuerySchema = paginationSchema.extend({
    piercingType: piercingTypeSchema.optional(),
    /** When omitted, returns both published and unpublished. Public route hides drafts. */
    isPublished: queryBoolean.optional(),
    search: z.string().trim().max(200).optional(),
});
export type AdminListAftercareQuery = z.infer<typeof adminListAftercareQuerySchema>;

/**
 * The aftercare `content` JSONB has a documented shape (overview / timeline /
 * daily_routine / dos / donts / warning_signs / downsizing — see
 * docs/06_DATABASE_SCHEMA.md §5.2). We don't enforce the inner shape here so
 * editors can iterate; bumping `version` is the convention for breaking
 * medical-content changes.
 */
const aftercareContentSchema = z.record(z.string(), z.unknown());

export const createAftercareGuideSchema = z.object({
    handle: aftercareHandleSchema,
    title: z.string().trim().min(1).max(200),
    piercingType: piercingTypeSchema,
    content: aftercareContentSchema,
    healingMinWeeks: z.coerce.number().int().min(0).max(520).nullable().optional(),
    healingMaxWeeks: z.coerce.number().int().min(0).max(520).nullable().optional(),
    iconUrl: z.string().url().max(512).nullable().optional(),
    serviceId: uuidSchema.nullable().optional(),
    metaTitle: z.string().trim().max(200).nullable().optional(),
    metaDescription: z.string().trim().max(500).nullable().optional(),
    version: z.coerce.number().int().min(1).optional(),
    isPublished: z.boolean().optional(),
});
export type CreateAftercareGuideInput = z.infer<typeof createAftercareGuideSchema>;

export const updateAftercareGuideSchema = createAftercareGuideSchema.partial();
export type UpdateAftercareGuideInput = z.infer<typeof updateAftercareGuideSchema>;

// ---------------------------------------------------------------------------
// 3D assets
// ---------------------------------------------------------------------------
export const listBodyModelsQuerySchema = z.object({
    area: z
        .string()
        .trim()
        .min(1)
        .max(30)
        .regex(/^[a-z_]+$/u)
        .optional(),
    side: z.enum(["left", "right"]).optional(),
});
export type ListBodyModelsQuery = z.infer<typeof listBodyModelsQuerySchema>;

export const listJewelryModelsQuerySchema = paginationSchema.extend({
    productId: uuidSchema.optional(),
});
export type ListJewelryModelsQuery = z.infer<typeof listJewelryModelsQuerySchema>;

export const listAnchorsQuerySchema = z.object({
    bodyModelId: uuidSchema,
});
export type ListAnchorsQuery = z.infer<typeof listAnchorsQuerySchema>;

// ---------------------------------------------------------------------------
// 3D admin (body models + anchors + jewelry models)
// ---------------------------------------------------------------------------

const sideSchema = z.enum(["left", "right"]);

const cameraDefaultsSchema = z
    .object({
        position: z.tuple([z.number(), z.number(), z.number()]).optional(),
        target: z.tuple([z.number(), z.number(), z.number()]).optional(),
        fov: z.number().min(1).max(170).optional(),
        minDistance: z.number().min(0).optional(),
        maxDistance: z.number().min(0).optional(),
    })
    .passthrough();

const skinTextureSchema = z
    .object({
        tone: z.string().trim().min(1).max(50),
        diffuse_url: z.string().url().max(512).optional(),
        normal_url: z.string().url().max(512).optional(),
        roughness_url: z.string().url().max(512).optional(),
    })
    .passthrough();

/** Admin: list filters (includes inactive). */
export const adminListBodyModelsQuerySchema = paginationSchema.extend({
    area: bodyAreaSchema.optional(),
    side: sideSchema.optional(),
    /** When `true`, include inactive body models. Default `false`. */
    includeInactive: queryBoolean.optional().default(false),
});
export type AdminListBodyModelsQuery = z.infer<typeof adminListBodyModelsQuerySchema>;

export const createBodyModelSchema = z.object({
    name: z.string().trim().min(1).max(100),
    area: bodyAreaSchema,
    side: sideSchema.nullable().optional(),
    modelUrl: z.string().url().max(512),
    modelUrlLod1: z.string().url().max(512).nullable().optional(),
    modelUrlLod2: z.string().url().max(512).nullable().optional(),
    thumbnailUrl: z.string().url().max(512).nullable().optional(),
    polygonCount: z.coerce.number().int().min(0).nullable().optional(),
    fileSizeBytes: z.coerce.number().int().min(0).nullable().optional(),
    cameraDefaults: cameraDefaultsSchema,
    skinTextures: z.array(skinTextureSchema).max(20).optional(),
    version: z.coerce.number().int().min(1).optional(),
    isActive: z.boolean().optional(),
});
export type CreateBodyModelInput = z.infer<typeof createBodyModelSchema>;

export const updateBodyModelSchema = createBodyModelSchema.partial();
export type UpdateBodyModelInput = z.infer<typeof updateBodyModelSchema>;

/**
 * Shape of one anchor in the bulk-replace payload. Mirrors the columns on
 * `piercing_point` but exposes a nested `position` / `rotation` / `normal`
 * object so callers can pass the same shape used elsewhere in the API
 * (visualizer reads, anchor-editor exports).
 *
 * The anchor-editor's legacy flat-snake-case shape (`position_x`, etc.) is
 * accepted by `anchorEditorPayloadSchema` below and converted on the way in.
 */
const vector3Schema = z.object({
    x: z.coerce.number(),
    y: z.coerce.number(),
    z: z.coerce.number(),
});

export const anchorSchema = z.object({
    /** Existing anchor id when updating; omitted on create. */
    id: uuidSchema.optional(),
    name: z
        .string()
        .trim()
        .min(1)
        .max(50)
        .regex(/^[a-z0-9_]+$/u, "Машинное имя: латиница, цифры, подчёркивание"),
    displayName: z.string().trim().min(1).max(100),
    position: vector3Schema,
    rotation: vector3Schema.optional(),
    normal: vector3Schema,
    compatibleJewelryTypes: z.array(z.string().trim().min(1).max(50)).min(1).max(20),
    compatibleGauges: z.array(z.string().trim().min(1).max(10)).max(20).optional(),
    maxJewelryDiameterMm: z.coerce.number().min(0).max(9999).nullable().optional(),
    serviceId: uuidSchema.nullable().optional(),
    sortOrder: z.coerce.number().int().optional(),
    isActive: z.boolean().optional(),
});
export type AnchorInput = z.infer<typeof anchorSchema>;

export const updateAnchorSchema = anchorSchema.partial().omit({ id: true });
export type UpdateAnchorInput = z.infer<typeof updateAnchorSchema>;

/**
 * Bulk-replace: the entire anchor set for a body model is wiped and
 * re-inserted in a single transaction. Existing anchors *referenced by
 * appointments/looks* aren't a concern at this layer because the FK uses
 * `ON DELETE` defaults that keep the historical record intact.
 *
 * Cap of 200 is well above the 50-100 estimated per model and prevents
 * a runaway POST from holding a write transaction open.
 */
export const replaceAnchorsSchema = z.object({
    anchors: z.array(anchorSchema.omit({ id: true })).max(200),
});
export type ReplaceAnchorsInput = z.infer<typeof replaceAnchorsSchema>;

/**
 * Anchor-editor.html legacy export shape. The HTML tool dumps anchors as a
 * flat array with snake_case keys (`position_x`, `body_area`, …). Accepting
 * this directly lets the editor POST its own export without re-shaping the
 * payload in browser JS.
 */
export const anchorEditorPayloadSchema = z.array(
    z
        .object({
            name: z.string().trim().min(1).max(50),
            display_name: z.string().trim().min(1).max(100).optional(),
            body_area: bodyAreaSchema.optional(),
            position_x: z.coerce.number(),
            position_y: z.coerce.number(),
            position_z: z.coerce.number(),
            rotation_x: z.coerce.number().optional(),
            rotation_y: z.coerce.number().optional(),
            rotation_z: z.coerce.number().optional(),
            normal_x: z.coerce.number(),
            normal_y: z.coerce.number(),
            normal_z: z.coerce.number(),
            compatible_jewelry_types: z.array(z.string().trim().min(1).max(50)).min(1).max(20),
            compatible_gauges: z.array(z.string().trim().min(1).max(10)).max(20).optional(),
        })
        .passthrough()
);
export type AnchorEditorPayload = z.infer<typeof anchorEditorPayloadSchema>;

// ---------------------------------------------------------------------------
// Jewelry 3D models (admin)
// ---------------------------------------------------------------------------
export const adminListJewelryModelsQuerySchema = paginationSchema.extend({
    productId: uuidSchema.optional(),
    status: z.enum(["active", "inactive", "processing"]).optional(),
    isValidated: queryBoolean.optional(),
});
export type AdminListJewelryModelsQuery = z.infer<typeof adminListJewelryModelsQuerySchema>;

export const createJewelryModelSchema = z.object({
    productId: uuidSchema,
    modelUrl: z.string().url().max(512),
    thumbnailUrl: z.string().url().max(512).nullable().optional(),
    polygonCount: z.coerce.number().int().min(0).nullable().optional(),
    fileSizeBytes: z.coerce.number().int().min(0).nullable().optional(),
    materialMapping: z.record(z.string(), z.unknown()).optional(),
    jewelryType: z.string().trim().min(1).max(50),
    defaultAttachment: z.string().trim().max(50).nullable().optional(),
    isValidated: z.boolean().optional(),
    validationErrors: z.array(z.string().max(500)).max(50).nullable().optional(),
    status: z.enum(["active", "inactive", "processing"]).optional(),
});
export type CreateJewelryModelInput = z.infer<typeof createJewelryModelSchema>;

export const updateJewelryModelSchema = createJewelryModelSchema.partial();
export type UpdateJewelryModelInput = z.infer<typeof updateJewelryModelSchema>;
