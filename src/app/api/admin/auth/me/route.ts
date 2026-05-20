/**
 * GET /api/admin/auth/me — current admin profile.
 *
 * Re-reads the admin_user row so callers see fresh `totp_enabled`, `role`,
 * and `last_login_at` values without waiting for the JWT to refresh. Returns
 * 404 if the JWT references an admin that's been deactivated or removed.
 */
import { eq } from "drizzle-orm";

import { internal, notFound, ok, requireAdmin } from "@/lib/api";
import { adminUsers, db } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    try {
        const [row] = await db
            .select({
                id: adminUsers.id,
                email: adminUsers.email,
                firstName: adminUsers.firstName,
                lastName: adminUsers.lastName,
                role: adminUsers.role,
                avatarUrl: adminUsers.avatarUrl,
                totpEnabled: adminUsers.totpEnabled,
                lastLoginAt: adminUsers.lastLoginAt,
                isActive: adminUsers.isActive,
                createdAt: adminUsers.createdAt,
            })
            .from(adminUsers)
            .where(eq(adminUsers.id, sess.userId))
            .limit(1);

        if (!row || !row.isActive) return notFound("Профиль администратора не найден");

        return ok({
            admin: row,
            session: { role: sess.role },
        });
    } catch (error) {
        console.error("[/api/admin/auth/me] failed", error);
        return internal();
    }
}
