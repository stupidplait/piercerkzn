/**
 * GET /api/booking/services/[handle] — single bookable service by URL handle.
 *
 * Returns a richer payload than the list endpoint, including the comma-separated
 * `compatibleJewelryTypes` field exploded into an array for client convenience.
 */
import { and, eq } from "drizzle-orm";

import { internal, notFound, ok } from "@/lib/api";
import { db, services } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ handle: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
    const { handle } = await ctx.params;
    if (!handle || handle.length > 100) return notFound("Услуга не найдена");

    try {
        const [row] = await db
            .select()
            .from(services)
            .where(and(eq(services.handle, handle), eq(services.isActive, true)))
            .limit(1);

        if (!row) return notFound("Услуга не найдена");

        const compatibleJewelryTypes = row.compatibleJewelryTypes
            ? row.compatibleJewelryTypes
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
            : [];

        return ok({
            service: {
                id: row.id,
                handle: row.handle,
                name: row.name,
                category: row.category,
                subcategory: row.subcategory,
                description: row.description,
                durationMinutes: row.durationMinutes,
                priceFrom: row.priceFrom,
                priceTo: row.priceTo,
                currencyCode: row.currencyCode,
                priceNote: row.priceNote,
                jewelryIncluded: row.jewelryIncluded,
                requiresConsultation: row.requiresConsultation,
                minimumAge: row.minimumAge,
                healingTimeMinWeeks: row.healingTimeMinWeeks,
                healingTimeMaxWeeks: row.healingTimeMaxWeeks,
                compatibleJewelryTypes,
                imageUrl: row.imageUrl,
                sortOrder: row.sortOrder,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
            },
        });
    } catch (error) {
        console.error("[/api/booking/services/:handle] failed", error);
        return internal();
    }
}
