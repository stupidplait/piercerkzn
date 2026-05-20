/**
 * 3D Visualization — body models, piercing anchor points, and jewelry GLB models.
 *
 * Body models ship as glTF 2.0 (.glb) compressed with Meshopt + KTX2.
 * Polygon budget: body 50–100K tris, jewelry 5–20K tris.
 * All files are served from Cloudflare R2 via CDN.
 */
import {
    boolean,
    bigint,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    text,
    timestamp,
    unique,
    varchar,
} from "drizzle-orm/pg-core";
import { services } from "./booking";
import { products } from "./products";

// ---------------------------------------------------------------------------
// Body Model
// ---------------------------------------------------------------------------
export const bodyModels = pgTable("body_model", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    name: varchar("name", { length: 100 }).notNull(),
    area: varchar("area", { length: 30 }).notNull(), // ear, nose, lip, eyebrow, navel, face
    side: varchar("side", { length: 10 }), // left, right, null (for centred anatomy)
    modelUrl: varchar("model_url", { length: 512 }).notNull(), // CDN GLB — high quality
    modelUrlLod1: varchar("model_url_lod1", { length: 512 }), // medium
    modelUrlLod2: varchar("model_url_lod2", { length: 512 }), // low
    thumbnailUrl: varchar("thumbnail_url", { length: 512 }),
    polygonCount: integer("polygon_count"),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    // { position:[x,y,z], target:[x,y,z], fov:45, minDistance:2, maxDistance:10, … }
    cameraDefaults: jsonb("camera_defaults").notNull(),
    // [{ tone:"light", diffuse_url:"…", normal_url:"…", roughness_url:"…" }]
    skinTextures: jsonb("skin_textures").default([]),
    version: integer("version").default(1),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Piercing Point  (spatial anchor on a body model)
// ---------------------------------------------------------------------------
export const piercingPoints = pgTable(
    "piercing_point",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        bodyModelId: varchar("body_model_id", { length: 36 })
            .notNull()
            .references(() => bodyModels.id, { onDelete: "cascade" }),
        name: varchar("name", { length: 50 }).notNull(), // machine name: 'helix_upper_1'
        displayName: varchar("display_name", { length: 100 }).notNull(), // Russian display name

        // World-space position
        positionX: numeric("position_x", { precision: 8, scale: 4 }).notNull(),
        positionY: numeric("position_y", { precision: 8, scale: 4 }).notNull(),
        positionZ: numeric("position_z", { precision: 8, scale: 4 }).notNull(),

        // Euler rotation for jewelry orientation
        rotationX: numeric("rotation_x", { precision: 8, scale: 4 }).default("0"),
        rotationY: numeric("rotation_y", { precision: 8, scale: 4 }).default("0"),
        rotationZ: numeric("rotation_z", { precision: 8, scale: 4 }).default("0"),

        // Surface normal (for snapping jewelry flush to skin)
        normalX: numeric("normal_x", { precision: 8, scale: 4 }).notNull(),
        normalY: numeric("normal_y", { precision: 8, scale: 4 }).notNull(),
        normalZ: numeric("normal_z", { precision: 8, scale: 4 }).notNull(),

        // Constraints
        compatibleJewelryTypes: text("compatible_jewelry_types").array().notNull(), // ['stud','hoop']
        compatibleGauges: text("compatible_gauges").array(), // ['18g','16g']
        maxJewelryDiameterMm: numeric("max_jewelry_diameter_mm", { precision: 5, scale: 1 }),
        serviceId: varchar("service_id", { length: 36 }).references(() => services.id),

        sortOrder: integer("sort_order").default(0),
        isActive: boolean("is_active").default(true),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
        bodyModelIdx: index("idx_pp_body_model").on(t.bodyModelId),
        bodyModelNameUniq: unique("uq_pp_body_model_name").on(t.bodyModelId, t.name),
    })
);

// ---------------------------------------------------------------------------
// Jewelry 3D Model
// ---------------------------------------------------------------------------
export const jewelry3dModels = pgTable(
    "jewelry_3d_model",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        productId: varchar("product_id", { length: 36 })
            .notNull()
            .references(() => products.id, { onDelete: "cascade" }),
        modelUrl: varchar("model_url", { length: 512 }).notNull(),
        thumbnailUrl: varchar("thumbnail_url", { length: 512 }),
        polygonCount: integer("polygon_count"),
        fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
        // { "mesh_body": { "polished_silver": "var_01", "gold_pvd": "var_02" } }
        materialMapping: jsonb("material_mapping").default({}),
        jewelryType: varchar("jewelry_type", { length: 50 }).notNull(),
        defaultAttachment: varchar("default_attachment", { length: 50 }), // default piercing point name
        isValidated: boolean("is_validated").default(false),
        validationErrors: text("validation_errors").array(),
        status: varchar("status", { length: 20 }).default("active"), // active | inactive | processing
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
        productIdx: index("idx_j3d_product").on(t.productId),
    })
);

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------
export type BodyModel = typeof bodyModels.$inferSelect;
export type NewBodyModel = typeof bodyModels.$inferInsert;
export type PiercingPoint = typeof piercingPoints.$inferSelect;
export type NewPiercingPoint = typeof piercingPoints.$inferInsert;
export type Jewelry3dModel = typeof jewelry3dModels.$inferSelect;
export type NewJewelry3dModel = typeof jewelry3dModels.$inferInsert;
