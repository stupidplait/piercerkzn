/**
 * POST /api/admin/auth/2fa/verify
 *
 * Two roles, decided by the current `totp_enabled` state:
 *
 *   - `enabled = false` (post-enrollment): verifies the first code against
 *     the pending secret and flips `totp_enabled = true`. From the next
 *     login onward the admin must supply a TOTP code.
 *
 *   - `enabled = true` (step-up): verifies a code against the current
 *     secret without changing state — useful for confirming sensitive
 *     actions in the admin UI before they're applied.
 *
 * Body: `{ code: "123456" }`.
 */
import { eq } from "drizzle-orm";

import { applyRateLimit, fail, internal, ok, parseJson, requireAdmin } from "@/lib/api";
import { adminUsers, db } from "@/db";
import { verifyTotpCode } from "@/lib/auth-totp";
import { capture } from "@/lib/posthog";
import { totpCodeSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    const parsed = await parseJson(req, totpCodeSchema);
    if (!parsed.ok) return parsed.response!;
    const { code } = parsed.data!;

    try {
        return await db.transaction(async (tx) => {
            const [admin] = await tx
                .select({
                    id: adminUsers.id,
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
                return fail(
                    "totp_not_initialized",
                    "Сначала запустите включение 2FA через /enable",
                    { status: 409 }
                );
            }
            if (!verifyTotpCode(code, admin.totpSecret)) {
                return fail("invalid_code", "Неверный код", { status: 400 });
            }

            const wasEnrollment = !admin.totpEnabled;
            if (wasEnrollment) {
                await tx
                    .update(adminUsers)
                    .set({ totpEnabled: true, updatedAt: new Date() })
                    .where(eq(adminUsers.id, admin.id));
            }

            capture({
                event: wasEnrollment ? "admin_2fa_enabled" : "admin_2fa_step_up_verified",
                distinctId: admin.id,
            });

            return ok({
                verified: true,
                totpEnabled: true,
                /** True when this call is the one that flipped enabled=true. */
                enrollmentCompleted: wasEnrollment,
            });
        });
    } catch (error) {
        console.error("[/api/admin/auth/2fa/verify] failed", error);
        return internal();
    }
}
