/**
 * Product catalog query / mutation validation.
 * Mirrors `docs/04_BACKEND_ENDPOINTS.md` §2 and §4.
 */
import { z } from "zod";
import { paginationSchema, uuidSchema } from "./common";

// ---------------------------------------------------------------------------
// Filter / sort taxonomy — kept in sync with the DB columns.
// ---------------------------------------------------------------------------
export const materials = [
    "titanium",
    "gold_14k",
    "gold_18k",
    "gold_white_14k",
    "gold_rose_14k",
    "steel",
    "niobium",
    "bioplast",
] as const;

export const jewelryTypes = [
    "stud",
    "hoop",
    "barbell",
    "labret",
    "captive",
    "bcr",
    "circular",
    "plug",
    "tunnel",
] as const;

export const piercingAreas = [
    "ear_helix",
    "ear_tragus",
    "ear_conch",
    "ear_lobe",
    "ear_industrial",
    "ear_rook",
    "ear_daith",
    "nose_septum",
    "nose_nostril",
    "nose_bridge",
    "lip_labret",
    "lip_medusa",
    "eyebrow",
    "navel",
    "tongue",
    "dermal",
    "nipple",
] as const;

export const productSorts = [
    "price_asc",
    "price_desc",
    "newest",
    "rating",
    "popularity",
    "relevance", // ts_rank_cd; only meaningful when `search` is set, otherwise falls back to newest
] as const;

export const listProductsQuerySchema = paginationSchema.extend({
    material: z.enum(materials).optional(),
    type: z.enum(jewelryTypes).optional(),
    area: z.enum(piercingAreas).optional(),
    gauge: z.string().max(10).optional(),
    categoryId: uuidSchema.optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    search: z.string().trim().max(200).optional(),
    sort: z.enum(productSorts).default("newest"),
    inStockOnly: z.coerce.boolean().optional(),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

// ---------------------------------------------------------------------------
// Admin product category mutations
// ---------------------------------------------------------------------------

// Slug pattern shared with other admin handle fields.
const productCategoryHandleSchema = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Слаг: латиница, цифры и дефис");

export const createProductCategorySchema = z.object({
    handle: productCategoryHandleSchema,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4_000).nullable().optional(),
    parentId: uuidSchema.nullable().optional(),
    imageUrl: z.string().url().max(512).nullable().optional(),
    sortOrder: z.coerce.number().int().optional(),
    isActive: z.boolean().optional(),
});
export type CreateProductCategoryInput = z.infer<typeof createProductCategorySchema>;

/**
 * Patch shape — defined directly (not via `.partial()`) so absent fields stay
 * absent and don't silently inject defaults from the create schema.
 */
export const updateProductCategorySchema = z.object({
    handle: productCategoryHandleSchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(4_000).nullable().optional(),
    parentId: uuidSchema.nullable().optional(),
    imageUrl: z.string().url().max(512).nullable().optional(),
    sortOrder: z.coerce.number().int().optional(),
    isActive: z.boolean().optional(),
});
export type UpdateProductCategoryInput = z.infer<typeof updateProductCategorySchema>;

// ---------------------------------------------------------------------------
// Admin product mutations
// ---------------------------------------------------------------------------
export const productPublishSchema = z.object({
    /** When `true`, force re-sending the new-arrival fanout even if the
     *  product was previously published. Defaults to `false`. */
    replayFanout: z.boolean().optional().default(false),
});
export type ProductPublishInput = z.infer<typeof productPublishSchema>;

// Slug shape: lowercase alphanumerics + dashes. Matches what the storefront
// URLs already use and rules out accidental whitespace / casing collisions.
const slugSchema = z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Слаг должен содержать только латиницу, цифры и дефис");

export const productStatuses = ["draft", "published", "archived"] as const;
export const threadings = ["threadless", "internal", "external"] as const;

/** Admin: list filters (extends the public list with status + soft-delete). */
export const adminListProductsQuerySchema = paginationSchema.extend({
    status: z.enum(productStatuses).optional(),
    material: z.enum(materials).optional(),
    type: z.enum(jewelryTypes).optional(),
    categoryId: uuidSchema.optional(),
    search: z.string().trim().max(200).optional(),
    /** When true, include soft-deleted rows. Default false. */
    includeDeleted: z.coerce.boolean().optional(),
    sort: z.enum([...productSorts]).default("newest"),
});
export type AdminListProductsQuery = z.infer<typeof adminListProductsQuerySchema>;

/** Admin: create a new product. `handle` is required and globally unique. */
export const createProductSchema = z.object({
    handle: slugSchema,
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(10_000).optional().nullable(),
    categoryId: uuidSchema.optional().nullable(),
    material: z.enum(materials),
    jewelryType: z.enum(jewelryTypes),
    threading: z.enum(threadings).optional().nullable(),
    status: z.enum(productStatuses).default("draft"),
    isFeatured: z.boolean().default(false),
    has3dModel: z.boolean().default(false),
    thumbnailUrl: z.string().url().max(512).optional().nullable(),
    metaTitle: z.string().trim().max(200).optional().nullable(),
    metaDescription: z.string().trim().max(500).optional().nullable(),
    ogImageUrl: z.string().url().max(512).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    /** Replace-mode list of piercing-area enum tags. If omitted, no areas are set. */
    piercingAreas: z.array(z.enum(piercingAreas)).optional(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

/** Admin: partial update. All fields are optional; `handle` updates trigger the
 *  unique constraint and the public catalog cache invalidator.
 *
 *  Note: we deliberately do NOT use `createProductSchema.partial()` because
 *  zod v4 preserves `.default()` through `.partial()`. That would silently
 *  inject `status: "draft"`, `isFeatured: false`, `has3dModel: false` into
 *  any PATCH payload that doesn't mention them, which would clobber existing
 *  values. Defining the optional shape directly keeps "absent" distinguishable
 *  from "explicitly default".
 */
export const updateProductSchema = z.object({
    handle: slugSchema.optional(),
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().max(10_000).optional().nullable(),
    categoryId: uuidSchema.optional().nullable(),
    material: z.enum(materials).optional(),
    jewelryType: z.enum(jewelryTypes).optional(),
    threading: z.enum(threadings).optional().nullable(),
    status: z.enum(productStatuses).optional(),
    isFeatured: z.boolean().optional(),
    has3dModel: z.boolean().optional(),
    thumbnailUrl: z.string().url().max(512).optional().nullable(),
    metaTitle: z.string().trim().max(200).optional().nullable(),
    metaDescription: z.string().trim().max(500).optional().nullable(),
    ogImageUrl: z.string().url().max(512).optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    /** Replace-mode list of piercing-area enum tags. Absent = leave untouched. */
    piercingAreas: z.array(z.enum(piercingAreas)).optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

// ---------------------------------------------------------------------------
// Admin product variant mutations
// ---------------------------------------------------------------------------
export const createVariantSchema = z.object({
    title: z.string().trim().min(1).max(255),
    sku: z.string().trim().min(1).max(100).optional().nullable(),
    materialFinish: z.string().trim().max(50).optional().nullable(),
    gauge: z.string().trim().max(10).optional().nullable(),
    /** Stored as numeric(5,1); accept numbers and coerce to string for Drizzle. */
    lengthMm: z.coerce.number().min(0).max(9999).optional().nullable(),
    diameterMm: z.coerce.number().min(0).max(9999).optional().nullable(),
    gemType: z.string().trim().max(50).optional().nullable(),
    gemColor: z.string().trim().max(50).optional().nullable(),
    /** Kopecks (integer). 12 000 == 120 ₽. */
    priceRub: z.coerce.number().int().min(0),
    priceUsd: z.coerce.number().int().min(0).optional().nullable(),
    originalPriceRub: z.coerce.number().int().min(0).optional().nullable(),
    saleStart: z.coerce.date().optional().nullable(),
    saleEnd: z.coerce.date().optional().nullable(),
    manageInventory: z.boolean().default(true),
    inventoryQuantity: z.coerce.number().int().min(0).default(0),
    lowStockThreshold: z.coerce.number().int().min(0).default(3),
    allowBackorder: z.boolean().default(false),
    imageUrl: z.string().url().max(512).optional().nullable(),
    model3dMaterialKey: z.string().trim().max(50).optional().nullable(),
    sortOrder: z.coerce.number().int().default(0),
});
export type CreateVariantInput = z.infer<typeof createVariantSchema>;

/** Admin: variant patch. Same defaults-on-partial pitfall as the product
 *  patch — defined directly so absent fields stay absent. */
export const updateVariantSchema = z.object({
    title: z.string().trim().min(1).max(255).optional(),
    sku: z.string().trim().min(1).max(100).optional().nullable(),
    materialFinish: z.string().trim().max(50).optional().nullable(),
    gauge: z.string().trim().max(10).optional().nullable(),
    lengthMm: z.coerce.number().min(0).max(9999).optional().nullable(),
    diameterMm: z.coerce.number().min(0).max(9999).optional().nullable(),
    gemType: z.string().trim().max(50).optional().nullable(),
    gemColor: z.string().trim().max(50).optional().nullable(),
    priceRub: z.coerce.number().int().min(0).optional(),
    priceUsd: z.coerce.number().int().min(0).optional().nullable(),
    originalPriceRub: z.coerce.number().int().min(0).optional().nullable(),
    saleStart: z.coerce.date().optional().nullable(),
    saleEnd: z.coerce.date().optional().nullable(),
    manageInventory: z.boolean().optional(),
    inventoryQuantity: z.coerce.number().int().min(0).optional(),
    lowStockThreshold: z.coerce.number().int().min(0).optional(),
    allowBackorder: z.boolean().optional(),
    imageUrl: z.string().url().max(512).optional().nullable(),
    model3dMaterialKey: z.string().trim().max(50).optional().nullable(),
    sortOrder: z.coerce.number().int().optional(),
});
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

// ---------------------------------------------------------------------------
// Admin piercing-area replace
// ---------------------------------------------------------------------------
export const replacePiercingAreasSchema = z.object({
    areas: z.array(z.enum(piercingAreas)).max(50),
});
export type ReplacePiercingAreasInput = z.infer<typeof replacePiercingAreasSchema>;

// ---------------------------------------------------------------------------
// Admin product media
// ---------------------------------------------------------------------------
export const productMediaKinds = ["image", "video", "model_3d", "thumbnail"] as const;

export const attachProductMediaSchema = z.object({
    url: z.string().url().max(512),
    alt: z.string().trim().max(255).optional().nullable(),
    kind: z.enum(productMediaKinds).default("image"),
    isPrimary: z.boolean().default(false),
    sortOrder: z.coerce.number().int().default(0),
    variantId: uuidSchema.optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type AttachProductMediaInput = z.infer<typeof attachProductMediaSchema>;

/**
 * Partial-update schema. We can't naively use `attachProductMediaSchema.partial()`
 * because zod v4 preserves `.default()` values through `.partial()`, which
 * means a PATCH payload like `{ url: "..." }` would silently inject
 * `isPrimary: false`, `kind: "image"`, `sortOrder: 0` and trip the route's
 * "cannot demote lone primary" guard. We therefore rebuild the optional shape
 * by hand for the fields that have defaults, so "absent" stays distinguishable
 * from "explicitly false / zero / image".
 */
export const updateProductMediaSchema = z.object({
    url: z.string().url().max(512).optional(),
    alt: z.string().trim().max(255).optional().nullable(),
    kind: z.enum(productMediaKinds).optional(),
    isPrimary: z.boolean().optional(),
    sortOrder: z.coerce.number().int().optional(),
    variantId: uuidSchema.optional().nullable(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type UpdateProductMediaInput = z.infer<typeof updateProductMediaSchema>;

export const reorderProductMediaSchema = z.object({
    /** Ordered list of media ids in the desired display order. Any media id
     *  that exists for the product but is omitted retains its current sort
     *  order, slotted in after the explicitly-ordered ones. */
    ordering: z.array(uuidSchema).min(1).max(50),
});
export type ReorderProductMediaInput = z.infer<typeof reorderProductMediaSchema>;

// ---------------------------------------------------------------------------
// Product reviews
// ---------------------------------------------------------------------------
export const submitReviewSchema = z.object({
    rating: z.number().int().min(1).max(5),
    title: z.string().trim().max(200).optional(),
    content: z.string().trim().min(10).max(5_000),
    images: z.array(z.string().url()).max(5).optional(),
});
export type SubmitReviewInput = z.infer<typeof submitReviewSchema>;
