/**
 * /api/admin/piercer-profile
 *
 *   GET   — singleton owner/piercer profile (full row, including
 *           rating fields the public route hides).
 *   PATCH — partial update of the singleton. Returns 404 if the seed
 *           hasn't run yet (defensive — the seed always creates one row
 *           with sentinel UUID `…000001`).
 *
 * `ratingAverage` and `ratingCount` are derived from the review pipeline
 * and not editable through this endpoint.
 */
import { asc, eq } from "drizzle-orm";

import { applyRateLimit, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { db, piercerProfile } from "@/db";
import { updatePiercerProfileSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET() {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [row] = await db
            .select()
            .from(piercerProfile)
            .orderBy(asc(piercerProfile.createdAt))
            .limit(1);
        if (!row) return notFound("Профиль мастера не найден (нужен seed)");
        return ok({ piercer: row });
    } catch (error) {
        console.error("[/api/admin/piercer-profile GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function PATCH(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updatePiercerProfileSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: piercerProfile.id })
            .from(piercerProfile)
            .orderBy(asc(piercerProfile.createdAt))
            .limit(1);
        if (!existing) return notFound("Профиль мастера не найден (нужен seed)");

        const patch: Partial<typeof piercerProfile.$inferInsert> = {
            updatedAt: new Date(),
        };
        if (input.firstName !== undefined) patch.firstName = input.firstName;
        if (input.lastName !== undefined) patch.lastName = input.lastName;
        if (input.title !== undefined) patch.title = input.title;
        if (input.bio !== undefined) patch.bio = input.bio;
        if (input.avatarUrl !== undefined) patch.avatarUrl = input.avatarUrl;
        if (input.bannerUrl !== undefined) patch.bannerUrl = input.bannerUrl;
        if (input.experienceYears !== undefined) patch.experienceYears = input.experienceYears;
        if (input.specializations !== undefined) patch.specializations = input.specializations;
        if (input.certifications !== undefined) patch.certifications = input.certifications;
        if (input.socialInstagram !== undefined) patch.socialInstagram = input.socialInstagram;
        if (input.socialTiktok !== undefined) patch.socialTiktok = input.socialTiktok;
        if (input.socialTelegram !== undefined) patch.socialTelegram = input.socialTelegram;

        const [updated] = await db
            .update(piercerProfile)
            .set(patch)
            .where(eq(piercerProfile.id, existing.id))
            .returning();

        return ok({ piercer: updated });
    } catch (error) {
        console.error("[/api/admin/piercer-profile PATCH] failed", error);
        return internal();
    }
}
