/**
 * Supporting entities — everything that doesn't fit the core commerce /
 * booking / visualization / content buckets.
 *
 * Includes: reviews, wishlists, contact inquiries, portfolio images,
 * admin users, notification logs, key-value settings, and the Telegram
 * bot user registry.
 */
import {
    bigint,
    boolean,
    index,
    integer,
    jsonb,
    pgTable,
    smallint,
    text,
    timestamp,
    unique,
    varchar,
} from "drizzle-orm/pg-core";
import { appointments } from "./booking";
import { customers } from "./customers";
import { products } from "./products";

// ---------------------------------------------------------------------------
// Review  (product or studio review)
// ---------------------------------------------------------------------------
export const reviews = pgTable(
    "review",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        type: varchar("type", { length: 20 }).notNull(), // 'product' | 'studio'
        productId: varchar("product_id", { length: 36 }).references(() => products.id, {
            onDelete: "cascade",
        }),
        customerId: varchar("customer_id", { length: 36 })
            .notNull()
            .references(() => customers.id),
        appointmentId: varchar("appointment_id", { length: 36 }).references(() => appointments.id),
        rating: smallint("rating").notNull(), // 1–5
        title: varchar("title", { length: 200 }),
        content: text("content"),
        images: text("images").array(), // CDN URLs
        isVerifiedClient: boolean("is_verified_client").default(false), // has visited the studio
        helpfulCount: integer("helpful_count").default(0),
        status: varchar("status", { length: 20 }).default("pending"), // pending | approved | rejected
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
        productIdx: index("idx_review_product").on(t.productId),
        customerIdx: index("idx_review_customer").on(t.customerId),
    })
);

// ---------------------------------------------------------------------------
// Review Helpful Vote  (one row per customer × review — dedup voting)
// ---------------------------------------------------------------------------
export const reviewHelpfulVotes = pgTable(
    "review_helpful_vote",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        reviewId: varchar("review_id", { length: 36 })
            .notNull()
            .references(() => reviews.id, { onDelete: "cascade" }),
        customerId: varchar("customer_id", { length: 36 })
            .notNull()
            .references(() => customers.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
        // Hard guarantee: each customer can vote a review helpful at most once.
        reviewCustomerUniq: unique("uq_helpful_review_customer").on(t.reviewId, t.customerId),
        reviewIdx: index("idx_helpful_review").on(t.reviewId),
        customerIdx: index("idx_helpful_customer").on(t.customerId),
    })
);

// ---------------------------------------------------------------------------
// Wishlist Item
// ---------------------------------------------------------------------------
export const wishlistItems = pgTable(
    "wishlist_item",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        customerId: varchar("customer_id", { length: 36 })
            .notNull()
            .references(() => customers.id, { onDelete: "cascade" }),
        productId: varchar("product_id", { length: 36 })
            .notNull()
            .references(() => products.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
        customerProductUniq: unique("uq_wishlist_customer_product").on(t.customerId, t.productId),
    })
);

// ---------------------------------------------------------------------------
// Inquiry  (contact form submission)
// ---------------------------------------------------------------------------
export const inquiries = pgTable("inquiry", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    referenceNumber: varchar("reference_number", { length: 20 }).unique().notNull(),
    name: varchar("name", { length: 200 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    subject: varchar("subject", { length: 50 }).notNull(), // general | booking | jewelry | complaint | collaboration
    message: text("message").notNull(),
    status: varchar("status", { length: 20 }).default("new"), // new | in_progress | resolved | closed
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Inquiry Reply
// ---------------------------------------------------------------------------
export const inquiryReplies = pgTable("inquiry_reply", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    inquiryId: varchar("inquiry_id", { length: 36 })
        .notNull()
        .references(() => inquiries.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    sentVia: varchar("sent_via", { length: 20 }).default("email"), // email | internal_note
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Portfolio Image
// ---------------------------------------------------------------------------
export const portfolioImages = pgTable("portfolio_image", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    imageUrl: varchar("image_url", { length: 512 }).notNull(),
    thumbnailUrl: varchar("thumbnail_url", { length: 512 }),
    piercingType: varchar("piercing_type", { length: 50 }),
    productId: varchar("product_id", { length: 36 }).references(() => products.id), // jewelry shown
    description: varchar("description", { length: 500 }),
    clientConsent: boolean("client_consent").default(true),
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Admin User  (studio owner / staff — single owner for MVP)
// ---------------------------------------------------------------------------
export const adminUsers = pgTable("admin_user", {
    id: varchar("id", { length: 36 })
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    email: varchar("email", { length: 255 }).unique().notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    firstName: varchar("first_name", { length: 100 }).notNull(),
    lastName: varchar("last_name", { length: 100 }),
    role: varchar("role", { length: 20 }).notNull().default("owner"), // owner | staff
    avatarUrl: varchar("avatar_url", { length: 512 }),
    totpSecret: varchar("totp_secret", { length: 255 }), // TOTP 2FA (otplib)
    totpEnabled: boolean("totp_enabled").default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Notification Log
// ---------------------------------------------------------------------------
export const notificationLogs = pgTable(
    "notification_log",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        customerId: varchar("customer_id", { length: 36 }).references(() => customers.id),
        channel: varchar("channel", { length: 20 }).notNull(), // email | sms | push | telegram
        type: varchar("type", { length: 50 }).notNull(), // reservation_confirmation | booking_reminder | aftercare | …
        recipient: varchar("recipient", { length: 255 }).notNull(), // email or phone
        subject: varchar("subject", { length: 500 }),
        contentPreview: varchar("content_preview", { length: 500 }),
        status: varchar("status", { length: 20 }).default("sent"), // sent | delivered | failed | bounced
        providerId: varchar("provider_id", { length: 255 }), // Resend message ID, etc.
        sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow(),
        metadata: jsonb("metadata").default({}),
    },
    (t) => ({
        customerIdx: index("idx_notif_customer").on(t.customerId),
        typeIdx: index("idx_notif_type").on(t.type),
        sentIdx: index("idx_notif_sent").on(t.sentAt),
    })
);

// ---------------------------------------------------------------------------
// Setting  (key-value configuration store)
// ---------------------------------------------------------------------------
export const settings = pgTable("setting", {
    key: varchar("key", { length: 100 }).primaryKey(), // e.g. 'reservation.hold_hours'
    value: jsonb("value").notNull(), // { text: "…" } | { number: 72 } | { bool: true }
    groupName: varchar("group_name", { length: 50 }).notNull(), // studio | booking | reservation | seo | notifications
    description: varchar("description", { length: 500 }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    updatedBy: varchar("updated_by", { length: 36 }), // admin_user.id
});

// ---------------------------------------------------------------------------
// Telegram Bot User  (links Telegram chats to customer accounts)
// ---------------------------------------------------------------------------
export const telegramBotUsers = pgTable(
    "telegram_bot_user",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        telegramId: bigint("telegram_id", { mode: "number" }).unique().notNull(),
        telegramUsername: varchar("telegram_username", { length: 255 }),
        firstName: varchar("first_name", { length: 100 }),
        lastName: varchar("last_name", { length: 100 }),
        languageCode: varchar("language_code", { length: 10 }).default("ru"),
        customerId: varchar("customer_id", { length: 36 }).references(() => customers.id),
        phone: varchar("phone", { length: 20 }),
        // FSM state for multi-step bot flows (reservation, booking)
        botState: jsonb("bot_state").default({}),
        notificationsEnabled: boolean("notifications_enabled").default(true),
        aftercareActive: boolean("aftercare_active").default(false),
        lastInteractionAt: timestamp("last_interaction_at", { withTimezone: true }),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
    },
    (t) => ({
        telegramIdx: index("idx_tg_user_telegram").on(t.telegramId),
        customerIdx: index("idx_tg_user_customer").on(t.customerId),
    })
);

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------
export type Review = typeof reviews.$inferSelect;
export type NewReview = typeof reviews.$inferInsert;
export type WishlistItem = typeof wishlistItems.$inferSelect;
export type NewWishlistItem = typeof wishlistItems.$inferInsert;
export type ReviewHelpfulVote = typeof reviewHelpfulVotes.$inferSelect;
export type NewReviewHelpfulVote = typeof reviewHelpfulVotes.$inferInsert;
export type Inquiry = typeof inquiries.$inferSelect;
export type NewInquiry = typeof inquiries.$inferInsert;
export type InquiryReply = typeof inquiryReplies.$inferSelect;
export type NewInquiryReply = typeof inquiryReplies.$inferInsert;
export type PortfolioImage = typeof portfolioImages.$inferSelect;
export type NewPortfolioImage = typeof portfolioImages.$inferInsert;
export type AdminUser = typeof adminUsers.$inferSelect;
export type NewAdminUser = typeof adminUsers.$inferInsert;
export type NotificationLog = typeof notificationLogs.$inferSelect;
export type NewNotificationLog = typeof notificationLogs.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;
export type TelegramBotUser = typeof telegramBotUsers.$inferSelect;
export type NewTelegramBotUser = typeof telegramBotUsers.$inferInsert;
