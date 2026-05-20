/**
 * GET /api/booking/services — public list of bookable piercing services.
 *
 * Filters: `category` (new_piercing | jewelry_change | consultation | checkup | downsize),
 *          `subcategory` (ear, nose, lip, eyebrow, navel, tongue, dermal, …).
 *
 * Sort: `sortOrder ASC, name ASC`. Inactive services are hidden.
 *
 * Backs the first step of the booking wizard at `/booking/service`.
 */
import { and, asc, eq, sql } from "drizzle-orm";

import { internal, ok, parseQuery } from "@/lib/api";
import { db, services } from "@/db";
import { listServicesQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = parseQuery(url, listServicesQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [eq(services.isActive, true)];
        if (q.category) filters.push(eq(services.category, q.category));
        if (q.subcategory) filters.push(eq(services.subcategory, q.subcategory));

        const where = and(...filters);

        const rows = await db
            .select({
                id: services.id,
                handle: services.handle,
                name: services.name,
                category: services.category,
                subcategory: services.subcategory,
                description: services.description,
                durationMinutes: services.durationMinutes,
                priceFrom: services.priceFrom,
                priceTo: services.priceTo,
                currencyCode: services.currencyCode,
                priceNote: services.priceNote,
                jewelryIncluded: services.jewelryIncluded,
                requiresConsultation: services.requiresConsultation,
                minimumAge: services.minimumAge,
                healingTimeMinWeeks: services.healingTimeMinWeeks,
                healingTimeMaxWeeks: services.healingTimeMaxWeeks,
                imageUrl: services.imageUrl,
                sortOrder: services.sortOrder,
            })
            .from(services)
            .where(where)
            .orderBy(asc(services.sortOrder), asc(services.name))
            .limit(q.limit)
            .offset(q.offset);

        const [{ total }] = await db
            .select({ total: sql<number>`count(*)::int` })
            .from(services)
            .where(where);

        return ok({
            services: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/booking/services] failed", error);
        return internal();
    }
}
