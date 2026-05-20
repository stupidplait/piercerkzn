/**
 * Product catalogue — categories, jewelry products, variants, and the
 * many-to-many link between products and piercing areas.
 *
 * Prices are stored as integer kopecks (RUB minor unit).
 * No cart, no checkout — this is a reservation-only flow.
 */
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
    boolean,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    primaryKey,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Product Category  (self-referential tree)
// ---------------------------------------------------------------------------
export const productCategories = pgTable("product_category", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    handle: varchar("handle", { length: 100 }).unique().notNull(),
    name: varchar("name", { length: 200 }).notNull(), // Russian
    description: text("description"),
    parentId: varchar("parent_id", { length: 36 }).references(
        (): AnyPgColumn => productCategories.id
    ),
    imageUrl: varchar("image_url", { length: 512 }),
    sortOrder: integer("sort_order").default(0),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------
export const products = pgTable(
    "product",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        handle: varchar("handle", { length: 255 }).unique().notNull(),
        title: varchar("title", { length: 500 }).notNull(), // Russian
        description: text("description"), // Russian
        categoryId: varchar("category_id", { length: 36 }).references(() => productCategories.id),
        material: varchar("material", { length: 50 }).notNull(), // titanium, gold_14k, …
        jewelryType: varchar("jewelry_type", { length: 50 }).notNull(), // stud, hoop, barbell, …
        threading: varchar("threading", { length: 20 }), // threadless, internal, external
        status: varchar("status", { length: 20 }).default("draft"), // draft, published, archived
        // First time the product entered `status='published'`. Used by the
        // new-arrival fanout (Phase E) to detect a freshly-published product
        // versus a re-publish, and as a candidate filter for the cron sweeper.
        publishedAt: timestamp("published_at", { withTimezone: true }),
        isFeatured: boolean("is_featured").default(false),
        thumbnailUrl: varchar("thumbnail_url", { length: 512 }),
        has3dModel: boolean("has_3d_model").default(false),
        // SEO
        metaTitle: varchar("meta_title", { length: 200 }),
        metaDescription: varchar("meta_description", { length: 500 }),
        ogImageUrl: varchar("og_image_url", { length: 512 }),
        // Flexible extras: astm_cert, hypoallergenic, gem_type, gem_color…
        metadata: jsonb("metadata").default({}),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (t) => ({
        handleIdx: index("idx_product_handle").on(t.handle),
        categoryIdx: index("idx_product_category").on(t.categoryId),
        materialIdx: index("idx_product_material").on(t.material),
        typeIdx: index("idx_product_type").on(t.jewelryType),
        statusIdx: index("idx_product_status").on(t.status),
        // GIN full-text index added in migration: CREATE INDEX idx_product_search
        // ON product USING gin(to_tsvector('russian', title || ' ' || COALESCE(description,'')));
    })
);

// ---------------------------------------------------------------------------
// Product Variant  (gauge / length / material finish / price)
// ---------------------------------------------------------------------------
export const productVariants = pgTable(
    "product_variant",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        productId: varchar("product_id", { length: 36 })
            .notNull()
            .references(() => products.id, { onDelete: "cascade" }),
        title: varchar("title", { length: 255 }).notNull(),
        sku: varchar("sku", { length: 100 }).unique(),
        // Options
        materialFinish: varchar("material_finish", { length: 50 }), // polished_silver, gold_pvd…
        gauge: varchar("gauge", { length: 10 }), // 20g, 18g, 16g, 14g
        lengthMm: numeric("length_mm", { precision: 5, scale: 1 }),
        diameterMm: numeric("diameter_mm", { precision: 5, scale: 1 }),
        gemType: varchar("gem_type", { length: 50 }), // cz, opal, pearl, none
        gemColor: varchar("gem_color", { length: 50 }),
        // Pricing (kopecks)
        priceRub: integer("price_rub").notNull(),
        priceUsd: integer("price_usd"),
        originalPriceRub: integer("original_price_rub"), // for sale display
        saleStart: timestamp("sale_start", { withTimezone: true }),
        saleEnd: timestamp("sale_end", { withTimezone: true }),
        // Inventory
        manageInventory: boolean("manage_inventory").default(true),
        inventoryQuantity: integer("inventory_quantity").default(0),
        lowStockThreshold: integer("low_stock_threshold").default(3),
        allowBackorder: boolean("allow_backorder").default(false),
        imageUrl: varchar("image_url", { length: 512 }),
        model3dMaterialKey: varchar("model_3d_material_key", { length: 50 }), // maps to 3D material preset
        sortOrder: integer("sort_order").default(0),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
        deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (t) => ({
        productIdx: index("idx_variant_product").on(t.productId),
        skuIdx: index("idx_variant_sku").on(t.sku),
    })
);

// ---------------------------------------------------------------------------
// Product ↔ Piercing Area  (M2M)
// ---------------------------------------------------------------------------
export const productPiercingAreas = pgTable(
    "product_piercing_area",
    {
        productId: varchar("product_id", { length: 36 })
            .notNull()
            .references(() => products.id, { onDelete: "cascade" }),
        piercingArea: varchar("piercing_area", { length: 50 }).notNull(), // ear_helix, nose_septum…
    },
    (t) => ({
        pk: primaryKey({ columns: [t.productId, t.piercingArea] }),
    })
);

// ---------------------------------------------------------------------------
// Product Media  (gallery — images, videos, 3D model previews)
// ---------------------------------------------------------------------------
// Multiple ordered assets per product, with optional per-variant overrides
// (e.g. a swatch image specific to a `gold_pvd` variant). Exactly one row
// per product is `is_primary = true`, enforced by a partial unique index in
// the accompanying migration. `products.thumbnail_url` is a denormalized
// cache of the current primary media URL, kept in sync by the admin write
// path; this keeps the public list endpoint snappy without a join.
export const productMedia = pgTable(
    "product_media",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        productId: varchar("product_id", { length: 36 })
            .notNull()
            .references(() => products.id, { onDelete: "cascade" }),
        variantId: varchar("variant_id", { length: 36 }).references(() => productVariants.id, {
            onDelete: "set null",
        }),
        url: varchar("url", { length: 512 }).notNull(),
        alt: varchar("alt", { length: 255 }),
        // 'image' (default) | 'video' | 'model_3d' | 'thumbnail'
        kind: varchar("kind", { length: 20 }).notNull().default("image"),
        isPrimary: boolean("is_primary").notNull().default(false),
        sortOrder: integer("sort_order").notNull().default(0),
        // Free-form: width/height for images, duration for videos, polyCount for 3d…
        metadata: jsonb("metadata").default({}),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
        productIdx: index("idx_product_media_product").on(t.productId),
        variantIdx: index("idx_product_media_variant").on(t.variantId),
    })
);

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------
export type ProductCategory = typeof productCategories.$inferSelect;
export type NewProductCategory = typeof productCategories.$inferInsert;
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type ProductVariant = typeof productVariants.$inferSelect;
export type NewProductVariant = typeof productVariants.$inferInsert;
export type ProductMedia = typeof productMedia.$inferSelect;
export type NewProductMedia = typeof productMedia.$inferInsert;
