/**
 * POST /api/auth/forgot-password
 *
 * Issues a single-use, time-limited password-reset token and emails it to the
 * customer. Always returns 200 with a generic message to avoid leaking which
 * emails are registered.
 *
 * Storage: reuses the Auth.js `auth_verification_token` table — the
 * `identifier` column is namespaced with the `pwreset:` prefix so it never
 * collides with magic-link tokens. The DB stores only the sha256 hash of
 * the raw token; the raw token is delivered exclusively via the reset link.
 *
 * Security:
 *   - Rate-limited (`auth` limiter — 5 req/min per IP).
 *   - Constant-time response shape regardless of email existence.
 *   - 30-minute TTL.
 *   - Tokens older than the issued one for the same email are purged
 *     before issuing a new one.
 */
import { eq } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

import { applyRateLimit, ok, parseJson } from "@/lib/api";
import { authVerificationTokens, customers, db } from "@/db";
import { sendPasswordResetEmail } from "@/emails/dispatch";
import { capture } from "@/lib/posthog";
import { forgotPasswordSchema } from "@/lib/validations/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PWRESET_PREFIX = "pwreset:";
const TTL_MINUTES = 30;

function siteOrigin(req: Request): string {
    const fromEnv = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.AUTH_URL;
    if (fromEnv) return fromEnv.replace(/\/$/, "");
    const url = new URL(req.url);
    return `${url.protocol}//${url.host}`;
}

function hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
}

const GENERIC_OK = {
    message: "Если аккаунт с таким email существует, мы отправили инструкции по сбросу пароля.",
};

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const parsed = await parseJson(req, forgotPasswordSchema);
    if (!parsed.ok) return parsed.response!;
    const { email } = parsed.data!;

    // Look up the customer. If absent / soft-deleted / OAuth-only — silently
    // skip the email step but still return the generic 200 envelope.
    const [customer] = await db
        .select({
            id: customers.id,
            email: customers.email,
            firstName: customers.firstName,
            passwordHash: customers.passwordHash,
            deletedAt: customers.deletedAt,
        })
        .from(customers)
        .where(eq(customers.email, email))
        .limit(1);

    if (!customer || customer.deletedAt || !customer.passwordHash) {
        return ok(GENERIC_OK);
    }

    const identifier = `${PWRESET_PREFIX}${customer.email}`;
    const rawToken = randomBytes(32).toString("hex"); // 64-char hex
    const tokenHash = hashToken(rawToken);
    const expires = new Date(Date.now() + TTL_MINUTES * 60_000);

    try {
        // Invalidate any prior reset tokens for this identifier.
        await db
            .delete(authVerificationTokens)
            .where(eq(authVerificationTokens.identifier, identifier));

        await db.insert(authVerificationTokens).values({
            identifier,
            token: tokenHash,
            expires,
        });

        const origin = siteOrigin(req);
        const resetUrl = `${origin}/auth/reset-password?token=${rawToken}`;

        await sendPasswordResetEmail({
            to: customer.email,
            customerId: customer.id,
            customerFirstName: customer.firstName,
            resetUrl,
            ttlMinutes: TTL_MINUTES,
        });

        capture({
            event: "password_reset_requested",
            distinctId: customer.id,
            properties: { method: "email" },
        });
    } catch (error) {
        // Don't leak failure details — log server-side and return generic OK.
        console.error("[/api/auth/forgot-password] failed", error);
    }

    return ok(GENERIC_OK);
}
