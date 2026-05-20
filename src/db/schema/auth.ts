/**
 * Auth.js v5 — Drizzle adapter tables.
 *
 * These are the four standard tables required by @auth/drizzle-adapter.
 * They are separate from the `customer` table — Auth.js manages sessions
 * and OAuth account linking; `customer` holds the domain profile.
 *
 * The adapter is configured in Phase 3 (src/lib/auth.ts).
 * See: https://authjs.dev/getting-started/adapters/drizzle
 */
import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// User  (Auth.js identity — maps 1:1 to a customer account)
// ---------------------------------------------------------------------------
export const authUsers = pgTable("auth_user", {
    id: text("id")
        .primaryKey()
        .$defaultFn(() => crypto.randomUUID()),
    name: text("name"),
    email: text("email").unique(),
    emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
    image: text("image"),
});

// ---------------------------------------------------------------------------
// Account  (OAuth provider links)
// ---------------------------------------------------------------------------
export const authAccounts = pgTable(
    "auth_account",
    {
        userId: text("user_id")
            .notNull()
            .references(() => authUsers.id, { onDelete: "cascade" }),
        type: text("type").notNull(), // 'oauth' | 'email' | 'credentials' | 'oidc'
        provider: text("provider").notNull(), // 'vk', 'telegram', 'credentials'
        providerAccountId: text("provider_account_id").notNull(),
        refresh_token: text("refresh_token"),
        access_token: text("access_token"),
        expires_at: integer("expires_at"),
        token_type: text("token_type"),
        scope: text("scope"),
        id_token: text("id_token"),
        session_state: text("session_state"),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.provider, t.providerAccountId] }),
        userIdx: index("idx_auth_account_user").on(t.userId),
    })
);

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
export const authSessions = pgTable(
    "auth_session",
    {
        sessionToken: text("session_token").primaryKey(),
        userId: text("user_id")
            .notNull()
            .references(() => authUsers.id, { onDelete: "cascade" }),
        expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
    },
    (t) => ({
        userIdx: index("idx_auth_session_user").on(t.userId),
    })
);

// ---------------------------------------------------------------------------
// Verification Token  (magic-link / email OTP)
// ---------------------------------------------------------------------------
export const authVerificationTokens = pgTable(
    "auth_verification_token",
    {
        identifier: text("identifier").notNull(),
        token: text("token").notNull(),
        expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
    },
    (t) => ({
        pk: primaryKey({ columns: [t.identifier, t.token] }),
    })
);

// ---------------------------------------------------------------------------
// Type exports
// ---------------------------------------------------------------------------
export type AuthUser = typeof authUsers.$inferSelect;
export type NewAuthUser = typeof authUsers.$inferInsert;
export type AuthAccount = typeof authAccounts.$inferSelect;
export type AuthSession = typeof authSessions.$inferSelect;
