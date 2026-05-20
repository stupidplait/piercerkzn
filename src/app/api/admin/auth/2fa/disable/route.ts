/**
 * POST /api/admin/auth/2fa/disable
 *
 * Turns TOTP off for the authenticated admin. Requires BOTH factors so a
 * single compromised channel can't silently weaken the account:
 *
 *   - `password` — re-verified with Argon2 against `admin_user.password_hash`.
 *   - `code`     — current TOTP code, verified against `admin_user.totp_secret`.
 *
 * On success: clears `totp_secret` and sets `totp_enabled = false`. The
 * admin can re-enroll later via `/enable` + `/verify`.
 *
 * Returns 409 if TOTP isn't currently enabled (nothing to disable). Pending
 * enrollments (secret set, enabled=false) are also cleared by this route to
 * give the UI a clean "cancel enrollment" path — surfaced via
 * `enrollmentCancelled` in the response.
 */
import { eq } from "drizzle-orm";

import { applyRateLimit, fail, internal, ok, parseJson, requireAdmin } from "@/lib/api";
import { adminUsers, db } from "@/db";
import { verifyTotpCode } from "@/lib/auth-totp";
import { verifyPassword } from "@/lib/auth-utils";
import { capture } from "@/lib/posthog";
import { totpDisableSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    const parsed = await parseJson(req, totpDisableSchema);
    if (!parsed.ok) return parsed.response!;
    const { password, code } = parsed.data!;

    try {
        return await db.transaction(async (tx) => {
            const [admin] = await tx
                .select({
                    id: adminUsers.id,
                    passwordHash: adminUsers.passwordHash,
                    totpSecret: adminUsers.totpSecret,
                    totpEnabled: adminUsers.totpEnabled,
                    isActive: adminUsers.isActive,
                })
                .from(adminUsers)
                .where(eq(adminUsers.id, sess.userId))
                .limit(1)
                .for("update");

            if (!admin || !admin.isActive) {
                return fail("not_found", "Профиль администратора не найден", { status: 404 });
            }
            if (!admin.totpSecret) {
                return fail("totp_not_initialized", "Двухфакторная аутентификация не настроена", {
                    status: 409,
                });
            }
            if (!(await verifyPassword(admin.passwordHash, password))) {
                return fail("invalid_password", "Неверный пароль", { status: 400 });
            }
            if (!verifyTotpCode(code, admin.totpSecret)) {
                return fail("invalid_code", "Неверный код", { status: 400 });
            }

            const wasEnabled = !!admin.totpEnabled;

            await tx
                .update(adminUsers)
                .set({ totpSecret: null, totpEnabled: false, updatedAt: new Date() })
                .where(eq(adminUsers.id, admin.id));

            capture({
                event: wasEnabled ? "admin_2fa_disabled" : "admin_2fa_enrollment_cancelled",
                distinctId: admin.id,
            });

            return ok({
                disabled: true,
                totpEnabled: false,
                /** True when this call cleared a confirmed (enabled) secret. */
                wasEnabled,
                /** True when this call cleared a pending (not-yet-enabled) secret. */
                enrollmentCancelled: !wasEnabled,
            });
        });
    } catch (error) {
        console.error("[/api/admin/auth/2fa/disable] failed", error);
        return internal();
    }
}
