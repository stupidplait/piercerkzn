/**
 * Customer — the visitor/client of the studio.
 * Supports both registered accounts and OAuth-only users.
 * Soft-deleted via deleted_at.
 */
import { boolean, date, index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const customers = pgTable(
    "customer",
    {
        id: varchar("id", { length: 36 })
            .primaryKey()
            .$defaultFn(() => crypto.randomUUID()),
        email: varchar("email", { length: 255 }).unique().notNull(),
        passwordHash: varchar("password_hash", { length: 255 }), // null for OAuth-only users
        firstName: varchar("first_name", { length: 100 }).notNull(),
        lastName: varchar("last_name", { length: 100 }),
        phone: varchar("phone", { length: 20 }),
        dateOfBirth: date("date_of_birth"),
        avatarUrl: varchar("avatar_url", { length: 512 }),
        locale: varchar("locale", { length: 5 }).default("ru"), // always 'ru'

        // OAuth
        oauthProvider: varchar("oauth_provider", { length: 20 }), // 'vk', 'telegram', null
        oauthId: varchar("oauth_id", { length: 255 }),

        // Notification preferences
        notificationEmail: boolean("notification_email").default(true),
        notificationSms: boolean("notification_sms").default(true),
        notificationPush: boolean("notification_push").default(false),
        notificationMarketing: boolean("notification_marketing").default(false),

        metadata: jsonb("metadata").default({}),
        createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
        updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
        deletedAt: timestamp("deleted_at", { withTimezone: true }), // soft delete
    },
    (t) => ({
        emailIdx: index("idx_customer_email").on(t.email),
        phoneIdx: index("idx_customer_phone").on(t.phone),
    })
);

export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;
