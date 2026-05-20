/**
 * Domain-side mirror of an Auth.js `auth_user` into the `customer` table.
 *
 * Auth.js (with the Drizzle adapter) owns identity tables — `auth_user`,
 * `auth_account`, `auth_session`, `auth_verification_token`. Our domain
 * code, however, joins everything through `customer.id` (reservations,
 * appointments, wishlist, telegram bot link, …). For the **email + password**
 * and **Telegram Login Widget** flows the credential providers already
 * resolve / create a `customer` row in `authorize()`. For **VK OAuth** and
 * **Resend magic-link**, the adapter inserts an `auth_user` row but never
 * touches `customer` — leaving the JWT with no `customerId` and the rest
 * of the app unable to write reservations.
 *
 * `ensureCustomerForAuthUser` closes that gap. It is called from the Node-
 * only `jwt` callback in `auth.ts` on the first sign-in event and:
 *
 *   1. Looks up an existing `customer` row by case-insensitive email.
 *      If found, backfills `oauth_provider` / `oauth_id` / `avatar_url` only
 *      when those columns are still null (no overwrites).
 *   2. Otherwise inserts a fresh row, deriving `first_name` from the
 *      Auth.js display name or the email local-part.
 *
 * Race-safe: a concurrent insert on the same email hits the `customer.email`
 * unique index; we recover by re-reading the row.
 *
 * Edge runtime: this file is Node-only — it imports `@/db`. `auth.config.ts`
 * (edge-safe) must NOT import it.
 */
import "server-only";

import { eq, sql } from "drizzle-orm";

import { customers, db, type Customer } from "@/db";

import { isUniqueViolation, mapOauthProvider, splitDisplayName } from "./auth-customer-sync.utils";

export { splitDisplayName } from "./auth-customer-sync.utils";

export interface AuthUserShape {
    /** `auth_user.id` — useful for diagnostics; we don't store it on `customer` (no FK column yet). */
    authUserId?: string | null;
    email: string;
    name?: string | null;
    image?: string | null;
    /** Auth.js account provider — `'vk'`, `'resend'` (magic-link), `'telegram'`, … */
    provider?: string | null;
    providerAccountId?: string | null;
}

/**
 * Returns the matching `customer` row, creating it if necessary. Always
 * returns a non-deleted row; if a soft-deleted customer exists for the
 * email, it's revived (deletedAt cleared) — re-signing-in implies intent
 * to use the account again.
 */
export async function ensureCustomerForAuthUser(input: AuthUserShape): Promise<Customer> {
    const email = input.email.trim().toLowerCase();
    if (!email) {
        throw new Error("ensureCustomerForAuthUser: email is required");
    }

    const { firstName, lastName } = splitDisplayName(input.name, email);

    // Map magic-link → null so we don't pollute the column with provider
    // names that aren't OAuth providers in our domain sense.
    const oauthProvider = mapOauthProvider(input.provider);
    const oauthId = oauthProvider ? (input.providerAccountId ?? null) : null;

    // 1. Fast path: existing row.
    const [existing] = await db
        .select()
        .from(customers)
        .where(eq(sql<string>`lower(${customers.email})`, email))
        .limit(1);

    if (existing) {
        const patch: Partial<typeof customers.$inferInsert> = {};
        if (existing.deletedAt) patch.deletedAt = null;
        if (!existing.oauthProvider && oauthProvider) patch.oauthProvider = oauthProvider;
        if (!existing.oauthId && oauthId) patch.oauthId = oauthId;
        if (!existing.avatarUrl && input.image) patch.avatarUrl = input.image;
        if (Object.keys(patch).length === 0) return existing;
        const [updated] = await db
            .update(customers)
            .set({ ...patch, updatedAt: new Date() })
            .where(eq(customers.id, existing.id))
            .returning();
        return updated;
    }

    // 2. Insert. A concurrent sign-in on the same email may race us; the
    //    unique index on `customer.email` is the arbiter.
    try {
        const [created] = await db
            .insert(customers)
            .values({
                email,
                firstName,
                lastName,
                avatarUrl: input.image ?? null,
                oauthProvider,
                oauthId,
            })
            .returning();
        return created;
    } catch (err) {
        if (isUniqueViolation(err)) {
            const [retry] = await db
                .select()
                .from(customers)
                .where(eq(sql<string>`lower(${customers.email})`, email))
                .limit(1);
            if (retry) return retry;
        }
        throw err;
    }
}
