/**
 * POST /api/admin/auth/2fa/enable
 *
 * Begin TOTP enrollment for the authenticated admin:
 *
 *   1. Generate a fresh base32 secret.
 *   2. Persist it on `admin_user.totp_secret` with `totp_enabled = false`
 *      (pending confirmation).
 *   3. Return the secret + otpauth URI so the client can render a QR.
 *
 * Step 4 happens at `POST /api/admin/auth/2fa/verify`, which checks the
 * user's first code and flips `totp_enabled = true`.
 *
 * Idempotency: calling enable on an already-pending secret rotates it
 * (issues a new one). Calling enable when TOTP is already enabled returns
 * 409 — the admin must explicitly disable first (out of scope here).
 */
import { eq } from "drizzle-orm";

import { applyRateLimit, fail, internal, ok, requireAdmin } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { adminUsers, db } from "@/db";
import { generateTotpSecret, totpKeyUri } from "@/lib/auth-totp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    try {
        return await db.transaction(async (tx) => {
            const [admin] = await tx
                .select({
                    id: adminUsers.id,
                    email: adminUsers.email,
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
            if (admin.totpEnabled) {
                return fail("already_enabled", "Двухфакторная аутентификация уже включена", {
                    status: 409,
                });
            }

            const secret = generateTotpSecret();
            await tx
                .update(adminUsers)
                .set({ totpSecret: secret, totpEnabled: false, updatedAt: new Date() })
                .where(eq(adminUsers.id, admin.id));

            const otpauthUrl = totpKeyUri(admin.email, secret);

            capture({
                event: "admin_2fa_enrollment_started",
                distinctId: admin.id,
            });

            return ok({
                /** Plain base32 secret — show as text fallback if QR fails. */
                secret,
                /** otpauth:// URI — feed to a QR component on the client. */
                otpauthUrl,
                /** Echo the issuer + account labels so the UI can confirm. */
                issuer: "PiercerKZN",
                account: admin.email,
            });
        });
    } catch (error) {
        console.error("[/api/admin/auth/2fa/enable] failed", error);
        return internal();
    }
}
