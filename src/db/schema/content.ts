/**
 * Content — blog posts and aftercare guides (managed via Payload CMS),
 * plus per-customer aftercare tracking.
 *
 * All content is Russian-only. Payload CMS owns the write path for
 * blog_post and aftercare_guide; the Drizzle schema is the source of truth
 * for querying from Server Components.
 */
import {
    boolean,
    date,
    index,
    integer,
    jsonb,
    pgTable,
    text,
    timestamp,
    varchar,
} from "drizzle-orm/pg-core";
import { piercerProfile, services } from "./booking";
import { customers } from "./customers";
import { adminUsers } from "./supporting";

// ---------------------------------------------------------------------------
// Blog Category
// ---------------------------------------------------------------------------
export const blogCategories = pgTable("blog_category", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    handle: varchar("handle", { length: 50 }).unique().notNull(),
    name: varchar("name", { length: 100 }).notNull(), // Russian
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Blog Post
// ---------------------------------------------------------------------------
export const blogPosts = pgTable(
    "blog_post",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        slug: varchar("slug", { length: 255 }).unique().notNull(),
        title: varchar("title", { length: 500 }).notNull(), // Russian
        excerpt: varchar("excerpt", { length: 1000 }), // Russian
        content: text("content").notNull(), // Markdown or Lexical rich-text JSON
        featuredImage: varchar("featured_image", { length: 512 }),
        categoryId: varchar("category_id", { length: 36 }).references(() => blogCategories.id),
        authorId: varchar("author_id", { length: 36 }).references(() => piercerProfile.id),
        status: varchar("status", { length: 20 }).default("draft"), // draft | published | archived
        publishedAt: timestamp("published_at", { withTimezone: true }),
        scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
        readTimeMin: integer("read_time_min"),
        viewCount: integer("view_count").default(0),
        metaTitle: varchar("meta_title", { length: 200 }),
        metaDescription: varchar("meta_description", { length: 500 }),
        tags: text("tags").array(),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
        slugIdx: index("idx_blog_slug").on(t.slug),
        statusIdx: index("idx_blog_status").on(t.status),
        publishedIdx: index("idx_blog_published").on(t.publishedAt),
    })
);

// ---------------------------------------------------------------------------
// Aftercare Guide
// ---------------------------------------------------------------------------
export const aftercareGuides = pgTable("aftercare_guide", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    handle: varchar("handle", { length: 100 }).unique().notNull(), // 'helix', 'septum'
    title: varchar("title", { length: 200 }).notNull(), // Russian
    piercingType: varchar("piercing_type", { length: 50 }).notNull(),
    /**
     * Structured JSONB — see docs/06_DATABASE_SCHEMA.md §5.2 for full shape:
     * { overview, timeline, daily_routine, dos, donts, warning_signs, downsizing }
     */
    content: jsonb("content").notNull(),
    healingMinWeeks: integer("healing_min_weeks"),
    healingMaxWeeks: integer("healing_max_weeks"),
    iconUrl: varchar("icon_url", { length: 512 }),
    serviceId: varchar("service_id", { length: 36 }).references(() => services.id),
    metaTitle: varchar("meta_title", { length: 200 }),
    metaDescription: varchar("meta_description", { length: 500 }),
    version: integer("version").default(1), // bump on medical content changes
    isPublished: boolean("is_published").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Aftercare Tracking  (per customer, per piercing)
// ---------------------------------------------------------------------------
export const aftercareTracking = pgTable(
    "aftercare_tracking",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        customerId: varchar("customer_id", { length: 36 })
            .notNull()
            .references(() => customers.id, { onDelete: "cascade" }),
        // Soft reference to appointment (avoids circular import with booking.ts)
        appointmentId: varchar("appointment_id", { length: 36 }),
        piercingType: varchar("piercing_type", { length: 50 }).notNull(),
        piercingDate: date("piercing_date").notNull(),
        guideId: varchar("guide_id", { length: 36 }).references(() => aftercareGuides.id),
        // [{ date: "2026-04-14", tasks_completed: ["clean","dry"], notes: "…" }]
        dailyLog: jsonb("daily_log").default([]),
        isActive: boolean("is_active").default(true),
        downsizeReminded: boolean("downsize_reminded").default(false),
        downsizeScheduled: boolean("downsize_scheduled").default(false),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
        customerIdx: index("idx_aftercare_customer").on(t.customerId),
    })
);

// ---------------------------------------------------------------------------
// Newsletter Campaign  (admin-authored marketing broadcasts)
// ---------------------------------------------------------------------------
export const newsletterCampaigns = pgTable(
    "newsletter_campaign",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        subject: text("subject").notNull(),
        preheader: text("preheader"),
        bodyMarkdown: text("body_markdown").notNull(),
        // draft | scheduled | sending | sent | cancelled
        state: varchar("state", { length: 20 }).notNull().default("draft"),
        scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
        startedAt: timestamp("started_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
        recipientCount: integer("recipient_count").notNull().default(0),
        sentCount: integer("sent_count").notNull().default(0),
        failedCount: integer("failed_count").notNull().default(0),
        createdByUserId: varchar("created_by_user_id", { length: 36 }).references(
            () => adminUsers.id,
            { onDelete: "set null" }
        ),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        stateScheduledIdx: index("idx_newsletter_state_scheduled").on(t.state, t.scheduledAt),
        stateStartedIdx: index("idx_newsletter_state_started").on(t.state, t.startedAt),
    })
);

// ---------------------------------------------------------------------------
// Telegram Broadcast  (admin-authored one-off Telegram broadcasts)
// ---------------------------------------------------------------------------
export const telegramBroadcasts = pgTable(
    "telegram_broadcast",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        title: varchar("title", { length: 200 }).notNull(), // Russian
        bodyText: text("body_text").notNull(), // Russian message body
        // 'HTML' | 'MarkdownV2' — CHECK constraint added in migration
        parseMode: varchar("parse_mode", { length: 20 }).notNull().default("HTML"),
        inlineButtonLabel: varchar("inline_button_label", { length: 64 }),
        inlineButtonUrl: varchar("inline_button_url", { length: 256 }),
        // 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled' — CHECK in migration
        state: varchar("state", { length: 20 }).notNull().default("draft"),
        scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
        startedAt: timestamp("started_at", { withTimezone: true }),
        completedAt: timestamp("completed_at", { withTimezone: true }),
        cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
        recipientCount: integer("recipient_count").notNull().default(0),
        sentCount: integer("sent_count").notNull().default(0),
        failedCount: integer("failed_count").notNull().default(0),
        createdByUserId: varchar("created_by_user_id", { length: 36 }).references(
            () => adminUsers.id,
            { onDelete: "set null" }
        ),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    },
    (t) => ({
        stateScheduledIdx: index("idx_telegram_broadcast_state_scheduled").on(
            t.state,
            t.scheduledAt
        ),
        stateStartedIdx: index("idx_telegram_broadcast_state_started").on(t.state, t.startedAt),
    })
);

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------
export type BlogCategory = typeof blogCategories.$inferSelect;
export type NewBlogCategory = typeof blogCategories.$inferInsert;
export type BlogPost = typeof blogPosts.$inferSelect;
export type NewBlogPost = typeof blogPosts.$inferInsert;
export type AftercareGuide = typeof aftercareGuides.$inferSelect;
export type NewAftercareGuide = typeof aftercareGuides.$inferInsert;
export type AftercareTracking = typeof aftercareTracking.$inferSelect;
export type NewAftercareTracking = typeof aftercareTracking.$inferInsert;
export type NewsletterCampaign = typeof newsletterCampaigns.$inferSelect;
export type NewNewsletterCampaign = typeof newsletterCampaigns.$inferInsert;
export type TelegramBroadcast = typeof telegramBroadcasts.$inferSelect;
export type NewTelegramBroadcast = typeof telegramBroadcasts.$inferInsert;
