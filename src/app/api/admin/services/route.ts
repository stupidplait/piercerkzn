/**
 * /api/admin/services
 *
 *   GET  — list services (admin: includes inactive).
 *   POST — create. Slug uniqueness pre-checked + 23505 fallback.
 */
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

import {
    applyRateLimit,
    fail,
    internal,
    ok,
    parseJson,
    parseQuery,
    pgErrorCode,
    requireAdmin,
} from "@/lib/api";
import { db, services } from "@/db";
import { adminListServicesQuerySchema, createServiceSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, adminListServicesQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.category) filters.push(eq(services.category, q.category));
        if (q.subcategory) filters.push(eq(services.subcategory, q.subcategory));
        if (q.isActive !== undefined) filters.push(eq(services.isActive, q.isActive));
        if (q.search) {
            const like = `%${q.search}%`;
            filters.push(or(ilike(services.name, like), ilike(services.handle, like))!);
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const orderBy = (() => {
            switch (q.sort) {
                case "newest":
                    return [desc(services.createdAt)];
                case "oldest":
                    return [asc(services.createdAt)];
                case "price":
                    return [asc(services.priceFrom), asc(services.name)];
                case "sortOrder":
                default:
                    return [asc(services.sortOrder), asc(services.name)];
            }
        })();

        const baseQuery = db.select().from(services);
        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(...orderBy)
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(services);
        const [{ total }] = await (where ? totalQuery.where(where) : totalQuery);

        return ok({
            services: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/services GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// POST — create
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createServiceSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: services.id })
            .from(services)
            .where(eq(services.handle, input.handle))
            .limit(1);
        if (existing) {
            return fail("handle_in_use", "Слаг услуги уже используется", { status: 409 });
        }

        const [created] = await db
            .insert(services)
            .values({
                name: input.name,
                handle: input.handle,
                category: input.category,
                subcategory: input.subcategory ?? null,
                description: input.description ?? null,
                durationMinutes: input.durationMinutes,
                priceFrom: input.priceFrom,
                priceTo: input.priceTo ?? null,
                currencyCode: input.currencyCode ?? "rub",
                priceNote: input.priceNote ?? null,
                jewelryIncluded: input.jewelryIncluded ?? false,
                requiresConsultation: input.requiresConsultation ?? false,
                minimumAge: input.minimumAge ?? 18,
                healingTimeMinWeeks: input.healingTimeMinWeeks ?? null,
                healingTimeMaxWeeks: input.healingTimeMaxWeeks ?? null,
                compatibleJewelryTypes: input.compatibleJewelryTypes ?? null,
                imageUrl: input.imageUrl ?? null,
                sortOrder: input.sortOrder ?? 0,
                isActive: input.isActive ?? true,
            })
            .returning();

        return ok({ service: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг услуги уже используется", { status: 409 });
        }
        console.error("[/api/admin/services POST] failed", error);
        return internal();
    }
}
