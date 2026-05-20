/**
 * POST /api/auth/reset-password
 *
 * Consumes a single-use password-reset token issued by
 * `/api/auth/forgot-password` and updates the customer's password hash.
 *
 * The DB stores only sha256(token); the route hashes the incoming raw token
 * before lookup. On success the verification token row is deleted (single
 * use) and the customer's `passwordHash` is replaced.
 *
 * Security:
 *   - Rate-limited (`auth` limiter — 5 req/min per IP).
 *   - Constant-time generic 400 for any failure (expired / wrong / unknown).
 *   - Token row is removed even when expired so attackers can't probe
 *     timing differences.
 */
import { and, eq, lt } from "drizzle-orm";
import { createHash } from "node:crypto";

import { applyRateLimit, fail, ok, parseJson } from "@/lib/api";
import { authVerificationTokens, customers, db } from "@/db";
import { hashPassword } from "@/lib/auth-utils";
import { capture } from "@/lib/posthog";
import { resetPasswordSchema } from "@/lib/validations/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PWRESET_PREFIX = "pwreset:";

function hashToken(raw: string): string {
    return createHash("sha256").update(raw).digest("hex");
}

const INVALID_TOKEN_ERROR = () =>
    fail("invalid_token", "Ссылка недействительна или устарела. Запросите сброс пароля заново.", {
        status: 400,
    });

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const parsed = await parseJson(req, resetPasswordSchema);
    if (!parsed.ok) return parsed.response!;
    const { token: rawToken, password } = parsed.data!;

    const tokenHash = hashToken(rawToken);

    // Locate the token row. We don't know the email up-front, so we filter on
    // the prefix + token hash.
    const [row] = await db
        .select()
        .from(authVerificationTokens)
        .where(eq(authVerificationTokens.token, tokenHash))
        .limit(1);

    if (!row || !row.identifier.startsWith(PWRESET_PREFIX)) {
        return INVALID_TOKEN_ERROR();
    }

    // Single-use: always remove the row, even if expired.
    await db
        .delete(authVerificationTokens)
        .where(
            and(
                eq(authVerificationTokens.identifier, row.identifier),
                eq(authVerificationTokens.token, row.token)
            )
        );

    if (row.expires.getTime() < Date.now()) {
        return INVALID_TOKEN_ERROR();
    }

    const email = row.identifier.slice(PWRESET_PREFIX.length);
    const [customer] = await db
        .select({
            id: customers.id,
            email: customers.email,
            deletedAt: customers.deletedAt,
        })
        .from(customers)
        .where(eq(customers.email, email))
        .limit(1);

    if (!customer || customer.deletedAt) {
        return INVALID_TOKEN_ERROR();
    }

    const newHash = await hashPassword(password);
    await db
        .update(customers)
        .set({ passwordHash: newHash, updatedAt: new Date() })
        .where(eq(customers.id, customer.id));

    // Best-effort: drop any lingering expired reset tokens for this user so
    // we don't accumulate dead rows. (The cron in `/api/cron/*` handles bulk
    // GC for the rest of the table.)
    await db
        .delete(authVerificationTokens)
        .where(
            and(
                eq(authVerificationTokens.identifier, row.identifier),
                lt(authVerificationTokens.expires, new Date())
            )
        )
        .catch(() => {
            // ignore
        });

    capture({
        event: "password_reset_completed",
        distinctId: customer.id,
        properties: { method: "email" },
    });

    return ok({ message: "Пароль обновлён. Войдите с новым паролем." });
}
