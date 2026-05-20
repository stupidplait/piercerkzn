/**
 * Auth.js v5 — Node-only config.
 *
 * Imports the edge-safe `auth.config.ts`, then layers on:
 *   - DrizzleAdapter (for OAuth account linking + magic-link verification tokens)
 *   - Credentials provider (email + password) — uses Argon2 (`@node-rs/argon2`)
 *   - Credentials provider (Telegram Login Widget) — HMAC-SHA256 verify
 *
 * Strategy: JWT sessions (Argon2 in `authorize` only runs on /api/auth/callback,
 * never in middleware). The adapter is still used for OAuth and magic-link.
 *
 * Linkage to the domain `customer` table:
 * - On Credentials sign-in we resolve `customerId` via `customer.email`
 *   inside `authorize()`.
 * - On VK / magic-link first sign-in, the adapter creates an `auth_user`
 *   row; the Node-only `jwt` callback below mirrors it into `customer`
 *   via `ensureCustomerForAuthUser()` and stamps `customerId` onto the JWT.
 *   Subsequent edge-runtime JWT decodes pass it through unchanged.
 */
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { db } from "@/db";
import {
    adminUsers,
    authAccounts,
    authSessions,
    authUsers,
    authVerificationTokens,
    customers,
} from "@/db/schema";

import authConfig from "./auth.config";
import { ensureCustomerForAuthUser } from "./auth-customer-sync";
import { verifyTotpCode } from "./auth-totp";
import { verifyPassword, verifyTelegramAuth, type TelegramAuthData } from "./auth-utils";
import { adminLoginSchema, loginSchema, telegramLoginSchema } from "./validations/auth";

// ---------------------------------------------------------------------------
// NextAuth instance
// ---------------------------------------------------------------------------
export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,

    adapter: DrizzleAdapter(db, {
        usersTable: authUsers,
        accountsTable: authAccounts,
        sessionsTable: authSessions,
        verificationTokensTable: authVerificationTokens,
    }),

    session: { strategy: "jwt" },

    callbacks: {
        ...authConfig.callbacks,
        // Node-only override of the edge-safe jwt callback in `auth.config.ts`.
        // The Drizzle adapter touches the DB on first OAuth / magic-link
        // sign-in but stops at `auth_user` — we mirror that into the domain
        // `customer` table here so every downstream feature (reservations,
        // appointments, wishlist, telegram link) has a stable `customerId`.
        async jwt({ token, user, account, trigger, session }) {
            if (user) {
                const passedCustomerId = (user as { customerId?: string }).customerId;
                const passedRole = (user as { role?: "customer" | "admin" | "staff" }).role;
                if (passedCustomerId) token.customerId = passedCustomerId;
                if (passedRole) token.role = passedRole;

                // First sign-in via VK or Resend magic-link: no Credentials
                // `authorize()` ran, so customerId is still empty. Skip for
                // admin / staff — they live in `admin_user`, not `customer`.
                const effectiveRole = token.role ?? passedRole ?? "customer";
                if (!token.customerId && effectiveRole !== "admin" && effectiveRole !== "staff") {
                    const email = user.email ?? (token.email as string | undefined) ?? null;
                    if (email) {
                        try {
                            const customer = await ensureCustomerForAuthUser({
                                authUserId:
                                    (user.id as string | undefined) ??
                                    (token.sub as string | undefined) ??
                                    null,
                                email,
                                name: user.name ?? null,
                                image: user.image ?? null,
                                provider: account?.provider ?? null,
                                providerAccountId: account?.providerAccountId ?? null,
                            });
                            token.customerId = customer.id;
                            token.role = "customer";
                        } catch (err) {
                            // Never block sign-in for the sync — the next
                            // request through the JWT will retry.
                            console.error("[auth] ensureCustomerForAuthUser failed", err);
                        }
                    }
                }
            }
            if (trigger === "update" && session) {
                const s = session as {
                    role?: "customer" | "admin" | "staff";
                    customerId?: string;
                };
                if (s.role) token.role = s.role;
                if (s.customerId) token.customerId = s.customerId;
            }
            return token;
        },
    },

    providers: [
        ...authConfig.providers,

        // -------------------------------------------------------------------
        // Email + password (customer + admin)
        // -------------------------------------------------------------------
        Credentials({
            id: "credentials",
            name: "Email",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Пароль", type: "password" },
            },
            async authorize(raw) {
                const parsed = loginSchema.safeParse(raw);
                if (!parsed.success) return null;
                const { email, password } = parsed.data;

                const [customer] = await db
                    .select()
                    .from(customers)
                    .where(eq(customers.email, email))
                    .limit(1);

                if (!customer || customer.deletedAt) return null;
                if (!customer.passwordHash) return null; // OAuth-only account
                if (!(await verifyPassword(customer.passwordHash, password))) return null;

                return {
                    id: customer.id,
                    email: customer.email,
                    name: [customer.firstName, customer.lastName].filter(Boolean).join(" ") || null,
                    image: customer.avatarUrl ?? null,
                    customerId: customer.id,
                    role: "customer" as const,
                };
            },
        }),

        // -------------------------------------------------------------------
        // Telegram Login Widget — HMAC-SHA256 verify against bot token.
        // The widget posts JSON to NextAuth credentials callback URL.
        // -------------------------------------------------------------------
        Credentials({
            id: "telegram",
            name: "Telegram",
            credentials: {
                id: { label: "id", type: "text" },
                first_name: { label: "first_name", type: "text" },
                last_name: { label: "last_name", type: "text" },
                username: { label: "username", type: "text" },
                photo_url: { label: "photo_url", type: "text" },
                auth_date: { label: "auth_date", type: "text" },
                hash: { label: "hash", type: "text" },
            },
            async authorize(raw) {
                const parsed = telegramLoginSchema.safeParse(raw);
                if (!parsed.success) return null;

                const botToken = process.env.TELEGRAM_BOT_TOKEN;
                if (!botToken) return null;

                const result = verifyTelegramAuth(parsed.data as TelegramAuthData, botToken);
                if (!result.valid) return null;

                // Look for an existing customer linked via oauth_provider/oauth_id.
                const tgId = String(parsed.data.id);
                const [existing] = await db
                    .select()
                    .from(customers)
                    .where(eq(customers.oauthId, tgId))
                    .limit(1);

                if (existing && !existing.deletedAt) {
                    return {
                        id: existing.id,
                        email: existing.email,
                        name:
                            [existing.firstName, existing.lastName].filter(Boolean).join(" ") ||
                            null,
                        image: existing.avatarUrl ?? null,
                        customerId: existing.id,
                        role: "customer" as const,
                    };
                }

                // First sign-in via Telegram — create a customer record.
                // Telegram does not give us an email; we use a deterministic
                // placeholder that the user can change later in /account.
                const placeholderEmail = `tg_${tgId}@telegram.placeholder.piercerkzn.ru`;
                const [created] = await db
                    .insert(customers)
                    .values({
                        email: placeholderEmail,
                        firstName: parsed.data.first_name,
                        lastName: parsed.data.last_name ?? null,
                        avatarUrl: parsed.data.photo_url ?? null,
                        oauthProvider: "telegram",
                        oauthId: tgId,
                    })
                    .returning();

                return {
                    id: created.id,
                    email: created.email,
                    name: [created.firstName, created.lastName].filter(Boolean).join(" ") || null,
                    image: created.avatarUrl ?? null,
                    customerId: created.id,
                    role: "customer" as const,
                };
            },
        }),

        // -------------------------------------------------------------------
        // Admin email + password (+ optional TOTP step-up).
        //
        // Auth.js Credentials returns null for any failure (we can't
        // distinguish "wrong password" from "TOTP required" via the standard
        // flow). The admin login UI submits with `code` either filled or
        // empty; if `totp_enabled` is true and no/invalid code is supplied,
        // auth fails. Clients should retry with the code field populated.
        // -------------------------------------------------------------------
        Credentials({
            id: "admin-credentials",
            name: "Admin",
            credentials: {
                email: { label: "Email", type: "email" },
                password: { label: "Пароль", type: "password" },
                code: { label: "Код 2FA", type: "text" },
            },
            async authorize(raw) {
                const parsed = adminLoginSchema.safeParse(raw);
                if (!parsed.success) return null;
                const { email, password, code } = parsed.data;

                const [admin] = await db
                    .select()
                    .from(adminUsers)
                    .where(eq(adminUsers.email, email))
                    .limit(1);

                if (!admin || !admin.isActive) return null;
                if (!(await verifyPassword(admin.passwordHash, password))) return null;

                if (admin.totpEnabled) {
                    if (!admin.totpSecret) return null;
                    if (!code) return null;
                    if (!verifyTotpCode(code, admin.totpSecret)) return null;
                }

                // Best-effort `last_login_at` stamp — never blocks login.
                void db
                    .update(adminUsers)
                    .set({ lastLoginAt: new Date() })
                    .where(eq(adminUsers.id, admin.id))
                    .catch((err) => {
                        console.error("[admin-credentials] lastLoginAt update failed", err);
                    });

                // `owner` collapses to `admin` on the JWT — fine-grained
                // owner-only checks (e.g. user management) re-read the
                // admin_user row server-side.
                const role: "admin" | "staff" = admin.role === "staff" ? "staff" : "admin";

                return {
                    id: admin.id,
                    email: admin.email,
                    name:
                        [admin.firstName, admin.lastName].filter(Boolean).join(" ") || admin.email,
                    image: admin.avatarUrl ?? null,
                    role,
                };
            },
        }),
    ],
});
