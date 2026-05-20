/**
 * POST /api/customers/me/change-password
 *
 * Replaces the customer's password hash. Requires the current password to be
 * proven (re-authentication). OAuth-only customers (no `passwordHash`) get a
 * 409 — they can set an initial password via `/api/auth/forgot-password` flow.
 *
 * Note on session invalidation: Auth.js JWT sessions cannot be revoked
 * server-side without flipping to DB sessions. The caller's current session
 * keeps working (which is what users expect after a password change anyway).
 */
import { eq } from "drizzle-orm";

import { applyRateLimit, fail, forbidden, internal, ok, parseJson, requireUser } from "@/lib/api";
import { customers, db } from "@/db";
import { hashPassword, verifyPassword } from "@/lib/auth-utils";
import { capture } from "@/lib/posthog";
import { changePasswordSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireUser();
    if (guard.response) return guard.response;
    const ctx = guard.ctx!;
    if (!ctx.customerId) return forbidden("Сессия не привязана к покупателю");

    const parsed = await parseJson(req, changePasswordSchema);
    if (!parsed.ok) return parsed.response!;
    const { currentPassword, newPassword } = parsed.data!;

    try {
        const [row] = await db
            .select({
                id: customers.id,
                passwordHash: customers.passwordHash,
                deletedAt: customers.deletedAt,
            })
            .from(customers)
            .where(eq(customers.id, ctx.customerId))
            .limit(1);

        if (!row || row.deletedAt) {
            return fail("not_found", "Профиль не найден", { status: 404 });
        }
        if (!row.passwordHash) {
            return fail(
                "no_password",
                "Этот аккаунт авторизуется через провайдер. Используйте «Забыли пароль?», чтобы задать пароль.",
                { status: 409 }
            );
        }

        const valid = await verifyPassword(row.passwordHash, currentPassword);
        if (!valid) {
            return fail("invalid_password", "Неверный текущий пароль", { status: 400 });
        }

        // No-op guard: don't waste an Argon2 cycle if the new password matches.
        if (await verifyPassword(row.passwordHash, newPassword)) {
            return fail("same_password", "Новый пароль должен отличаться от текущего", {
                status: 400,
            });
        }

        const newHash = await hashPassword(newPassword);
        await db
            .update(customers)
            .set({ passwordHash: newHash, updatedAt: new Date() })
            .where(eq(customers.id, ctx.customerId));

        capture({
            event: "customer_password_changed",
            distinctId: ctx.customerId,
            properties: { method: "self_service" },
        });

        return ok({ message: "Пароль обновлён" });
    } catch (error) {
        console.error("[/api/customers/me/change-password] failed", error);
        return internal();
    }
}
