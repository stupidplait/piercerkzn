/**
 * /api/admin/aftercare/[id]
 *
 *   GET    — full detail.
 *   PATCH  — partial update. Admins must bump `version` themselves on
 *            breaking medical-content changes — we don't auto-bump because
 *            most edits (typo fixes, formatting) are non-breaking.
 *   DELETE — soft (default: isPublished=false) or hard with ?hard=true.
 *            Hard delete is refused with 409 if any active aftercare_tracking
 *            row still references the guide; the FK has no cascade so the
 *            DB would otherwise raise 23503.
 */
import { eq, sql } from "drizzle-orm";

import {
    applyRateLimit,
    fail,
    internal,
    notFound,
    ok,
    parseJson,
    pgErrorCode,
    requireAdmin,
} from "@/lib/api";
import { aftercareGuides, aftercareTracking, db } from "@/db";
import { updateAftercareGuideSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [row] = await db
            .select()
            .from(aftercareGuides)
            .where(eq(aftercareGuides.id, id))
            .limit(1);
        if (!row) return notFound("Гайд не найден");
        return ok({ guide: row });
    } catch (error) {
        console.error("[/api/admin/aftercare/:id GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updateAftercareGuideSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select()
            .from(aftercareGuides)
            .where(eq(aftercareGuides.id, id))
            .limit(1);
        if (!existing) return notFound("Гайд не найден");

        // Cross-field validation: max >= min when both end up populated.
        const finalMin =
            input.healingMinWeeks !== undefined ? input.healingMinWeeks : existing.healingMinWeeks;
        const finalMax =
            input.healingMaxWeeks !== undefined ? input.healingMaxWeeks : existing.healingMaxWeeks;
        if (finalMin != null && finalMax != null && finalMax < finalMin) {
            return fail("healing_range_invalid", "healingMaxWeeks должен быть >= healingMinWeeks", {
                status: 400,
            });
        }

        const patch: Partial<typeof aftercareGuides.$inferInsert> = {
            updatedAt: new Date(),
        };
        if (input.handle !== undefined) patch.handle = input.handle;
        if (input.title !== undefined) patch.title = input.title;
        if (input.piercingType !== undefined) patch.piercingType = input.piercingType;
        if (input.content !== undefined) patch.content = input.content;
        if (input.healingMinWeeks !== undefined) patch.healingMinWeeks = input.healingMinWeeks;
        if (input.healingMaxWeeks !== undefined) patch.healingMaxWeeks = input.healingMaxWeeks;
        if (input.iconUrl !== undefined) patch.iconUrl = input.iconUrl;
        if (input.serviceId !== undefined) patch.serviceId = input.serviceId;
        if (input.metaTitle !== undefined) patch.metaTitle = input.metaTitle;
        if (input.metaDescription !== undefined) patch.metaDescription = input.metaDescription;
        if (input.version !== undefined) patch.version = input.version;
        if (input.isPublished !== undefined) patch.isPublished = input.isPublished;

        const [updated] = await db
            .update(aftercareGuides)
            .set(patch)
            .where(eq(aftercareGuides.id, id))
            .returning();

        return ok({ guide: updated });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг гайда уже используется", { status: 409 });
        }
        if (pgErrorCode(error) === "23503") {
            return fail("invalid_reference", "Несуществующая услуга", { status: 400 });
        }
        console.error("[/api/admin/aftercare/:id PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE — soft (isPublished=false) or hard with FK guard
// ---------------------------------------------------------------------------
export async function DELETE(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const hard = url.searchParams.get("hard") === "true";

    try {
        const [existing] = await db
            .select({ id: aftercareGuides.id, isPublished: aftercareGuides.isPublished })
            .from(aftercareGuides)
            .where(eq(aftercareGuides.id, id))
            .limit(1);
        if (!existing) return notFound("Гайд не найден");

        if (hard) {
            // FK guard: aftercare_tracking.guide_id has no ON DELETE clause.
            const [{ trackingCount }] = await db
                .select({ trackingCount: sql<number>`count(*)::int` })
                .from(aftercareTracking)
                .where(eq(aftercareTracking.guideId, id));
            if (trackingCount > 0) {
                return fail(
                    "guide_in_use",
                    `На гайд ссылается ${trackingCount} активных трекеров. Используйте мягкое удаление.`,
                    { status: 409 }
                );
            }
            await db.delete(aftercareGuides).where(eq(aftercareGuides.id, id));
            return ok({ deleted: true, mode: "hard" });
        }

        if (existing.isPublished === false) {
            return ok({ deleted: true, mode: "soft", alreadyUnpublished: true });
        }

        const [updated] = await db
            .update(aftercareGuides)
            .set({ isPublished: false, updatedAt: new Date() })
            .where(eq(aftercareGuides.id, id))
            .returning({ id: aftercareGuides.id, isPublished: aftercareGuides.isPublished });

        return ok({ deleted: true, mode: "soft", guide: updated });
    } catch (error) {
        console.error("[/api/admin/aftercare/:id DELETE] failed", error);
        return internal();
    }
}
