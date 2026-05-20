/**
 * /api/admin/services/[id]
 *
 *   GET    — full detail.
 *   PATCH  — partial update. Cross-field rules (priceTo >= priceFrom,
 *            healing range) re-validated after merging the patch with the
 *            existing row, so PATCH-only changes can't sneak past create-
 *            time guards.
 *   DELETE — soft (isActive=false) by default; hard with `?hard=true`. Hard
 *            delete is FK-guarded against `appointment_service.service_id`
 *            (no cascade): refuses with 409 if any historical appointment
 *            still references the service.
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
import { appointmentServices, db, services } from "@/db";
import { updateServiceSchema } from "@/lib/validations";

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
        const [row] = await db.select().from(services).where(eq(services.id, id)).limit(1);
        if (!row) return notFound("Услуга не найдена");
        return ok({ service: row });
    } catch (error) {
        console.error("[/api/admin/services/:id GET] failed", error);
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

    const parsed = await parseJson(req, updateServiceSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db.select().from(services).where(eq(services.id, id)).limit(1);
        if (!existing) return notFound("Услуга не найдена");

        // Re-validate cross-field rules after merging the patch with the row.
        const merged = {
            priceFrom: input.priceFrom !== undefined ? input.priceFrom : existing.priceFrom,
            priceTo: input.priceTo !== undefined ? input.priceTo : existing.priceTo,
            minWeeks:
                input.healingTimeMinWeeks !== undefined
                    ? input.healingTimeMinWeeks
                    : existing.healingTimeMinWeeks,
            maxWeeks:
                input.healingTimeMaxWeeks !== undefined
                    ? input.healingTimeMaxWeeks
                    : existing.healingTimeMaxWeeks,
        };
        if (merged.priceTo != null && merged.priceTo < merged.priceFrom) {
            return fail("price_range_invalid", "priceTo должен быть >= priceFrom", { status: 400 });
        }
        if (
            merged.minWeeks != null &&
            merged.maxWeeks != null &&
            merged.maxWeeks < merged.minWeeks
        ) {
            return fail(
                "healing_range_invalid",
                "healingTimeMaxWeeks должен быть >= healingTimeMinWeeks",
                { status: 400 }
            );
        }

        const patch: Partial<typeof services.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) patch.name = input.name;
        if (input.handle !== undefined) patch.handle = input.handle;
        if (input.category !== undefined) patch.category = input.category;
        if (input.subcategory !== undefined) patch.subcategory = input.subcategory;
        if (input.description !== undefined) patch.description = input.description;
        if (input.durationMinutes !== undefined) patch.durationMinutes = input.durationMinutes;
        if (input.priceFrom !== undefined) patch.priceFrom = input.priceFrom;
        if (input.priceTo !== undefined) patch.priceTo = input.priceTo;
        if (input.currencyCode !== undefined) patch.currencyCode = input.currencyCode;
        if (input.priceNote !== undefined) patch.priceNote = input.priceNote;
        if (input.jewelryIncluded !== undefined) patch.jewelryIncluded = input.jewelryIncluded;
        if (input.requiresConsultation !== undefined)
            patch.requiresConsultation = input.requiresConsultation;
        if (input.minimumAge !== undefined) patch.minimumAge = input.minimumAge;
        if (input.healingTimeMinWeeks !== undefined)
            patch.healingTimeMinWeeks = input.healingTimeMinWeeks;
        if (input.healingTimeMaxWeeks !== undefined)
            patch.healingTimeMaxWeeks = input.healingTimeMaxWeeks;
        if (input.compatibleJewelryTypes !== undefined)
            patch.compatibleJewelryTypes = input.compatibleJewelryTypes;
        if (input.imageUrl !== undefined) patch.imageUrl = input.imageUrl;
        if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
        if (input.isActive !== undefined) patch.isActive = input.isActive;

        const [updated] = await db
            .update(services)
            .set(patch)
            .where(eq(services.id, id))
            .returning();

        return ok({ service: updated });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг услуги уже используется", { status: 409 });
        }
        console.error("[/api/admin/services/:id PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE — soft (isActive=false) or hard with FK guard
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
            .select({ id: services.id, isActive: services.isActive })
            .from(services)
            .where(eq(services.id, id))
            .limit(1);
        if (!existing) return notFound("Услуга не найдена");

        if (hard) {
            const [{ refCount }] = await db
                .select({ refCount: sql<number>`count(*)::int` })
                .from(appointmentServices)
                .where(eq(appointmentServices.serviceId, id));
            if (refCount > 0) {
                return fail(
                    "service_in_use",
                    `Услуга используется в ${refCount} записях. Используйте мягкое удаление.`,
                    { status: 409 }
                );
            }
            await db.delete(services).where(eq(services.id, id));
            return ok({ deleted: true, mode: "hard" });
        }

        if (existing.isActive === false) {
            return ok({ deleted: true, mode: "soft", alreadyInactive: true });
        }

        const [updated] = await db
            .update(services)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(services.id, id))
            .returning({ id: services.id, isActive: services.isActive });

        return ok({ deleted: true, mode: "soft", service: updated });
    } catch (error) {
        console.error("[/api/admin/services/:id DELETE] failed", error);
        return internal();
    }
}
