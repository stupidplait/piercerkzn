/**
 * Booking — services, piercer profile (singleton), schedule, appointments,
 * and waivers.
 *
 * Single piercer, single calendar. No multi-artist logic.
 * All payments are cash-at-studio; estimated_total is informational only.
 *
 * Circular reference: appointments.waiver_id ↔ waivers.appointment_id
 * Resolved with AnyPgColumn lazy reference — appointments is declared first.
 */
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
    boolean,
    date,
    index,
    integer,
    jsonb,
    numeric,
    pgTable,
    serial,
    text,
    time,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";
import { customers } from "./customers";
import { productVariants } from "./products";
import { reservations } from "./reservations";

// ---------------------------------------------------------------------------
// Service  (piercing menu item)
// ---------------------------------------------------------------------------
export const services = pgTable("service", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    name: varchar("name", { length: 200 }).notNull(), // Russian
    handle: varchar("handle", { length: 100 }).unique().notNull(),
    category: varchar("category", { length: 30 }).notNull(), // new_piercing, jewelry_change, consultation, checkup, downsize
    subcategory: varchar("subcategory", { length: 30 }), // ear, nose, lip, eyebrow, navel, tongue, dermal
    description: text("description"), // Russian
    durationMinutes: integer("duration_minutes").notNull(),
    priceFrom: integer("price_from").notNull(), // kopecks
    priceTo: integer("price_to"), // null = fixed price
    currencyCode: varchar("currency_code", { length: 3 }).default("rub"),
    priceNote: varchar("price_note", { length: 500 }), // "Зависит от украшения"
    jewelryIncluded: boolean("jewelry_included").default(false),
    requiresConsultation: boolean("requires_consultation").default(false),
    minimumAge: integer("minimum_age").default(18),
    healingTimeMinWeeks: integer("healing_time_min_weeks"),
    healingTimeMaxWeeks: integer("healing_time_max_weeks"),
    compatibleJewelryTypes: varchar("compatible_jewelry_types", { length: 500 }), // CSV: stud,hoop,barbell
    imageUrl: varchar("image_url", { length: 512 }),
    sortOrder: integer("sort_order").default(0),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Piercer Profile  (singleton — always exactly one row)
// ---------------------------------------------------------------------------
export const piercerProfile = pgTable("piercer_profile", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }),
    title: varchar("title", { length: 100 }), // "Owner & Professional Piercer"
    bio: text("bio"), // Russian
    avatarUrl: varchar("avatar_url", { length: 512 }),
    bannerUrl: varchar("banner_url", { length: 512 }),
    experienceYears: integer("experience_years"),
    specializations: text("specializations").array(), // ['ear_curation', 'septum', 'dermal']
    certifications: text("certifications").array(), // ['app_member', 'bloodborne_pathogen']
    socialInstagram: varchar("social_instagram", { length: 255 }),
    socialTiktok: varchar("social_tiktok", { length: 255 }),
    socialTelegram: varchar("social_telegram", { length: 255 }),
    ratingAverage: numeric("rating_average", { precision: 3, scale: 1 }).default("0.0"),
    ratingCount: integer("rating_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Piercer Schedule  (recurring weekly slots)
// ---------------------------------------------------------------------------
export const piercerSchedule = pgTable("piercer_schedule", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    dayOfWeek: integer("day_of_week").unique().notNull(), // 0 = Monday … 6 = Sunday
    isWorking: boolean("is_working").default(true),
    startTime: time("start_time"), // e.g. '10:00'
    endTime: time("end_time"), // e.g. '19:00'
    breaks: jsonb("breaks").default([]), // [{ start: "13:00", end: "14:00" }]
});

// ---------------------------------------------------------------------------
// Schedule Exception  (day-off or special hours override)
// ---------------------------------------------------------------------------
export const scheduleExceptions = pgTable(
    "schedule_exception",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        date: date("date").unique().notNull(),
        isWorking: boolean("is_working").default(false),
        startTime: time("start_time"),
        endTime: time("end_time"),
        reason: varchar("reason", { length: 255 }),
    },
    (t) => ({
        dateIdx: index("idx_exception_date").on(t.date),
    })
);

// ---------------------------------------------------------------------------
// Time Block  (one-off blocked slot within a working day)
// ---------------------------------------------------------------------------
export const timeBlocks = pgTable(
    "time_block",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        date: date("date").notNull(),
        startTime: time("start_time").notNull(),
        endTime: time("end_time").notNull(),
        reason: varchar("reason", { length: 255 }),
    },
    (t) => ({
        dateIdx: index("idx_block_date").on(t.date),
    })
);

// ---------------------------------------------------------------------------
// Waiver Template  (versioned legal text)
// ---------------------------------------------------------------------------
export const waiverTemplates = pgTable("waiver_template", {
    id: serial("id").primaryKey(),
    version: integer("version").unique().notNull(),
    content: text("content").notNull(), // full legal text in Russian (markdown)
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    createdBy: varchar("created_by", { length: 36 }), // admin_user.id
});

// ---------------------------------------------------------------------------
// Appointment  (declared before Waiver to allow lazy FK in Waiver)
// ---------------------------------------------------------------------------
export const appointments = pgTable(
    "appointment",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        referenceNumber: varchar("reference_number", { length: 20 }).unique().notNull(), // PK-APT-2026-0089
        customerId: varchar("customer_id", { length: 36 }).references(() => customers.id),

        // Contact snapshot
        customerFirstName: varchar("customer_first_name", { length: 100 }).notNull(),
        customerLastName: varchar("customer_last_name", { length: 100 }),
        customerEmail: varchar("customer_email", { length: 255 }).notNull(),
        customerPhone: varchar("customer_phone", { length: 20 }).notNull(),
        customerDob: date("customer_dob"),

        // Scheduling
        date: date("date").notNull(),
        timeStart: time("time_start").notNull(),
        timeEnd: time("time_end").notNull(),
        totalDurationMin: integer("total_duration_min").notNull(),

        // Status machine
        status: varchar("status", { length: 20 }).default("pending"),
        // pending | confirmed | in_progress | completed | cancelled | no_show | rescheduled

        // Financial — informational only, all cash at studio
        estimatedTotal: integer("estimated_total").notNull(),

        // Circular refs — resolved lazily
        waiverId: varchar("waiver_id", { length: 36 }).references((): AnyPgColumn => waivers.id),
        reservationId: varchar("reservation_id", { length: 36 }).references(() => reservations.id),

        // Notes
        customerNotes: text("customer_notes"),
        internalNotes: text("internal_notes"),
        completionNotes: text("completion_notes"),

        // { from_visualizer, look_id }
        metadata: jsonb("metadata").default({}),

        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
        cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
    },
    (t) => ({
        customerIdx: index("idx_appointment_customer").on(t.customerId),
        dateIdx: index("idx_appointment_date").on(t.date),
        statusIdx: index("idx_appointment_status").on(t.status),
        refIdx: index("idx_appointment_ref").on(t.referenceNumber),
    })
);

// ---------------------------------------------------------------------------
// Waiver  (signed consent record — declared after Appointment)
// ---------------------------------------------------------------------------
export const waivers = pgTable("waiver", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    appointmentId: varchar("appointment_id", { length: 36 }).references(() => appointments.id),
    customerId: varchar("customer_id", { length: 36 }).references(() => customers.id),
    templateVersion: integer("template_version").notNull(),
    fullName: varchar("full_name", { length: 200 }).notNull(),
    signatureData: text("signature_data").notNull(), // base64 PNG, encrypted at rest
    signedAt: timestamp("signed_at", { withTimezone: true }).defaultNow(),
    ipAddress: varchar("ip_address", { length: 45 }), // audit trail
    userAgent: text("user_agent"),
});

// ---------------------------------------------------------------------------
// Appointment Service  (junction — which services are in this appointment)
// ---------------------------------------------------------------------------
export const appointmentServices = pgTable("appointment_service", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    appointmentId: varchar("appointment_id", { length: 36 })
        .notNull()
        .references(() => appointments.id, { onDelete: "cascade" }),
    serviceId: varchar("service_id", { length: 36 })
        .notNull()
        .references(() => services.id),
    price: integer("price").notNull(), // kopecks snapshot
    durationMinutes: integer("duration_minutes").notNull(),
});

// ---------------------------------------------------------------------------
// Appointment Jewelry  (junction — which jewelry is used in this appointment)
// ---------------------------------------------------------------------------
export const appointmentJewelry = pgTable("appointment_jewelry", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    appointmentId: varchar("appointment_id", { length: 36 })
        .notNull()
        .references(() => appointments.id, { onDelete: "cascade" }),
    variantId: varchar("variant_id", { length: 36 }).references(() => productVariants.id),
    piercingPoint: varchar("piercing_point", { length: 50 }),
    source: varchar("source", { length: 20 }).default("catalog"), // catalog | visualizer | at_studio
    price: integer("price"), // kopecks
});

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------
export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
export type PiercerProfile = typeof piercerProfile.$inferSelect;
export type NewPiercerProfile = typeof piercerProfile.$inferInsert;
export type PiercerSchedule = typeof piercerSchedule.$inferSelect;
export type NewPiercerSchedule = typeof piercerSchedule.$inferInsert;
export type Appointment = typeof appointments.$inferSelect;
export type NewAppointment = typeof appointments.$inferInsert;
export type Waiver = typeof waivers.$inferSelect;
export type NewWaiver = typeof waivers.$inferInsert;
export type WaiverTemplate = typeof waiverTemplates.$inferSelect;
export type NewWaiverTemplate = typeof waiverTemplates.$inferInsert;
