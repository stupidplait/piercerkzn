/**
 * Auth.js v5 — edge-safe config.
 *
 * This file is imported by `src/middleware.ts` and runs in the Edge runtime.
 * It MUST NOT import:
 *   - `@/db`           (postgres driver)
 *   - `@/lib/auth`     (full config with adapter)
 *   - `auth-utils.ts`  (Argon2 native module)
 *
 * Only edge-safe providers (VK OAuth, Resend magic-link) live here.
 * The Credentials providers (with Argon2 / Telegram HMAC) are added in
 * `auth.ts` which is Node-only.
 *
 * See: https://authjs.dev/getting-started/migrating-to-v5#edge-compatibility
 */
import type { NextAuthConfig } from "next-auth";
import VK from "next-auth/providers/vk";
import Resend from "next-auth/providers/resend";

const isProd = process.env.NODE_ENV === "production";

const authConfig = {
    // Providers safe to evaluate in edge runtime.
    // Credentials providers are added in `auth.ts` (Node-only).
    providers: [
        // Auth.js v5 auto-reads AUTH_VK_ID / AUTH_VK_SECRET when no args given.
        VK,
        Resend({
            apiKey: process.env.RESEND_API_KEY,
            from: process.env.RESEND_FROM_EMAIL ?? "PiercerKZN <no-reply@piercerkzn.ru>",
            // Russian-only product — override default English template.
            // Full RU HTML template lives in src/emails/ (Phase 10);
            // for now we ship a minimal RU stub so dev sign-ins work.
            async sendVerificationRequest({ identifier, url, provider }) {
                const res = await fetch("https://api.resend.com/emails", {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${provider.apiKey}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        from: provider.from,
                        to: identifier,
                        subject: "Вход в PiercerKZN",
                        text:
                            `Подтвердите вход в PiercerKZN, перейдя по ссылке:\n\n${url}\n\n` +
                            `Если вы не запрашивали вход — просто проигнорируйте это письмо.`,
                        html:
                            `<p>Подтвердите вход в <b>PiercerKZN</b>, перейдя по ссылке:</p>` +
                            `<p><a href="${url}">${url}</a></p>` +
                            `<p style="color:#888">Если вы не запрашивали вход — просто проигнорируйте это письмо.</p>`,
                    }),
                });
                if (!res.ok) {
                    const body = await res.text().catch(() => "");
                    throw new Error(`Resend send failed (${res.status}): ${body.slice(0, 200)}`);
                }
            },
        }),
    ],

    pages: {
        signIn: "/auth/login",
        // verifyRequest: "/auth/login/check-email", // Phase 6.x — auth pages
        // error: "/auth/login/error",
    },

    session: { strategy: "jwt" },

    // Edge-callable callbacks. Heavy DB work (looking up `customer.id` by
    // email) happens in the Node-only `authorize()` of Credentials and is
    // forwarded here via `user` on first sign-in only.
    callbacks: {
        // Coarse-grained route gate — fine-grained checks live in middleware.ts.
        authorized({ auth, request }) {
            const path = request.nextUrl.pathname;
            const isAdminPath = path.startsWith("/admin");
            const isAccountPath = path.startsWith("/account");
            if (!isAdminPath && !isAccountPath) return true;
            if (!auth) return false;
            if (isAdminPath) return auth.user?.role === "admin" || auth.user?.role === "staff";
            return true; // /account/* — any authenticated user
        },

        async jwt({ token, user, trigger, session }) {
            if (user) {
                // First sign-in (Credentials, OAuth callback, magic-link).
                token.customerId = (user as { customerId?: string }).customerId;
                token.role = (user as { role?: "customer" | "admin" | "staff" }).role ?? "customer";
            }
            if (trigger === "update" && session) {
                // Allow client-side `update()` to refresh role/customerId.
                if (session.role) token.role = session.role;
                if (session.customerId) token.customerId = session.customerId;
            }
            return token;
        },

        async session({ session, token }) {
            if (session.user) {
                session.user.id = (token.sub ?? "") as string;
                session.user.customerId = token.customerId as string | undefined;
                session.user.role =
                    (token.role as "customer" | "admin" | "staff" | undefined) ?? "customer";
            }
            return session;
        },
    },

    trustHost: true,
    // Cookies default to __Secure-* in prod (HTTPS-only) — Auth.js handles it.
    debug: !isProd,
} satisfies NextAuthConfig;

export default authConfig;
