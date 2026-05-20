/**
 * Curated Looks — studio-composed multi-piece sets shown in the visualizer,
 * and customer-saved looks built from the visualizer session.
 *
 * A "look" is a named combination of jewelry pieces placed on specific
 * piercing points of a body model. Curated looks are published by the studio;
 * saved looks are private to the customer who composed them.
 */
import {
    boolean,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { productVariants } from "./products";
import { bodyModels, piercingPoints } from "./visualization";

// ---------------------------------------------------------------------------
// Curated Look  (studio-published)
// ---------------------------------------------------------------------------
export const curatedLooks = pgTable("curated_look", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    handle: varchar("handle", { length: 100 }).unique().notNull(),
    title: varchar("title", { length: 200 }).notNull(), // Russian
    description: text("description"), // Russian
    bodyModelId: varchar("body_model_id", { length: 36 })
        .notNull()
        .references(() => bodyModels.id),
    bodyArea: varchar("body_area", { length: 30 }).notNull(),
    thumbnailUrl: varchar("thumbnail_url", { length: 512 }),
    // Pricing in kopecks
    totalIndividualPrice: integer("total_individual_price").notNull(), // sum of all pieces at full price
    bundlePrice: integer("bundle_price").notNull(), // discounted bundle price
    discountPercent: numeric("discount_percent", { precision: 4, scale: 1 }),
    currencyCode: varchar("currency_code", { length: 3 }).default("rub"),
    // Camera state for 3D preview: { position: [x,y,z], target: [x,y,z] }
    cameraState: jsonb("camera_state"),
    isPublished: boolean("is_published").default(false),
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Look Piece  (junction: look + piercing point + variant)
// ---------------------------------------------------------------------------
export const lookPieces = pgTable("look_piece", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    lookId: varchar("look_id", { length: 36 })
        .notNull()
        .references(() => curatedLooks.id, { onDelete: "cascade" }),
    piercingPointId: varchar("piercing_point_id", { length: 36 })
        .notNull()
        .references(() => piercingPoints.id),
    variantId: varchar("variant_id", { length: 36 })
        .notNull()
        .references(() => productVariants.id),
    sortOrder: integer("sort_order").default(0),
});

// ---------------------------------------------------------------------------
// Saved Look  (customer-composed from the 3D visualizer)
// ---------------------------------------------------------------------------
export const savedLooks = pgTable(
    "saved_look",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        customerId: varchar("customer_id", { length: 36 })
            .notNull()
            .references(() => customers.id, { onDelete: "cascade" }),
        title: varchar("title", { length: 200 }),
        bodyModelId: varchar("body_model_id", { length: 36 })
            .notNull()
            .references(() => bodyModels.id),
        // [{ piercing_point_id: "…", variant_id: "…" }]
        pieces: jsonb("pieces").notNull(),
        cameraState: jsonb("camera_state"),
        thumbnailUrl: varchar("thumbnail_url", { length: 512 }), // canvas.toBlob() snapshot
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
        customerIdx: index("idx_saved_look_customer").on(t.customerId),
    })
);

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------
export type CuratedLook = typeof curatedLooks.$inferSelect;
export type NewCuratedLook = typeof curatedLooks.$inferInsert;
export type LookPiece = typeof lookPieces.$inferSelect;
export type NewLookPiece = typeof lookPieces.$inferInsert;
export type SavedLook = typeof savedLooks.$inferSelect;
export type NewSavedLook = typeof savedLooks.$inferInsert;
