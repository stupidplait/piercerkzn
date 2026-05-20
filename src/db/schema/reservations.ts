/**
 * Reservation — replaces the traditional Cart/Checkout/Order flow.
 *
 * Visitors reserve jewelry online → pick up and pay cash at the studio.
 * No online payments. No card forms. The client-side cart is managed by
 * Zustand + localStorage; only confirmed reservations are persisted here.
 *
 * Lifecycle: pending → confirmed → picked_up
 *                    → cancelled (by customer or studio)
 *                    → expired   (auto after hold_hours, via BullMQ job)
 */
import { index, integer, jsonb, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { productVariants, products } from "./products";

// ---------------------------------------------------------------------------
// Reservation
// ---------------------------------------------------------------------------
export const reservations = pgTable(
    "reservation",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        referenceNumber: varchar("reference_number", { length: 20 }).unique().notNull(), // PK-RES-2026-0042
        customerId: varchar("customer_id", { length: 36 }).references(() => customers.id),

        // Contact snapshot — stored even for guest (non-registered) customers
        customerFirstName: varchar("customer_first_name", { length: 100 }).notNull(),
        customerLastName: varchar("customer_last_name", { length: 100 }),
        customerEmail: varchar("customer_email", { length: 255 }).notNull(),
        customerPhone: varchar("customer_phone", { length: 20 }).notNull(),

        // Status machine
        status: varchar("status", { length: 20 }).default("pending"),
        // pending | confirmed | picked_up | cancelled | expired

        // Totals in kopecks — informational only, never charged online
        total: integer("total").notNull(),
        currencyCode: varchar("currency_code", { length: 3 }).default("rub"),

        // 72-hour hold window (configurable via studio.reservation.hold_hours setting)
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

        // Notes
        customerNotes: text("customer_notes"),
        internalNotes: text("internal_notes"), // not visible to customer

        // Source metadata: { from: 'visualizer' | 'catalog' | 'look', look_id? }
        metadata: jsonb("metadata").default({}),

        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
        confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
        pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
        cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
        expiredAt: timestamp("expired_at", { withTimezone: true }),
    },
    (t) => ({
        customerIdx: index("idx_reservation_customer").on(t.customerId),
        statusIdx: index("idx_reservation_status").on(t.status),
        refIdx: index("idx_reservation_ref").on(t.referenceNumber),
        expiresIdx: index("idx_reservation_expires").on(t.expiresAt),
    })
);

// ---------------------------------------------------------------------------
// Reservation Item
// ---------------------------------------------------------------------------
export const reservationItems = pgTable(
    "reservation_item",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        reservationId: varchar("reservation_id", { length: 36 })
            .notNull()
            .references(() => reservations.id, { onDelete: "cascade" }),
        productId: varchar("product_id", { length: 36 }).references(() => products.id),
        variantId: varchar("variant_id", { length: 36 }).references(() => productVariants.id),

        // Product snapshot at time of reservation (survives product edits/deletions)
        title: varchar("title", { length: 500 }).notNull(),
        variantTitle: varchar("variant_title", { length: 255 }),
        sku: varchar("sku", { length: 100 }),
        thumbnailUrl: varchar("thumbnail_url", { length: 512 }),

        // Pricing snapshot in kopecks
        unitPrice: integer("unit_price").notNull(),
        quantity: integer("quantity").notNull().default(1),
        total: integer("total").notNull(),

        // { from_visualizer, piercing_point, look_id }
        metadata: jsonb("metadata").default({}),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
        reservationIdx: index("idx_reservation_item_res").on(t.reservationId),
    })
);

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------
export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;
export type ReservationItem = typeof reservationItems.$inferSelect;
export type NewReservationItem = typeof reservationItems.$inferInsert;
