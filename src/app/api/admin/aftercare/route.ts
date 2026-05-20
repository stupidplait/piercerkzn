/**
 * /api/admin/aftercare
 *
 *   GET  — list aftercare guides (admin: includes unpublished).
 *   POST — create. Slug + piercingType uniqueness checks before insert.
 *
 * The structured `content` JSONB is stored as-is (see
 * docs/06_DATABASE_SCHEMA.md §5.2). Bumping `version` is the convention
 * for breaking medical-content changes — admins should bump it manually
 * when meaningfully altering a guide.
 */
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";

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
import { aftercareGuides, db } from "@/db";
import { adminListAftercareQuerySchema, createAftercareGuideSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, adminListAftercareQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.piercingType) filters.push(eq(aftercareGuides.piercingType, q.piercingType));
        if (q.isPublished !== undefined)
            filters.push(eq(aftercareGuides.isPublished, q.isPublished));
        if (q.search) {
            const like = `%${q.search}%`;
            filters.push(
                or(
                    ilike(aftercareGuides.title, like),
                    ilike(aftercareGuides.handle, like),
                    ilike(aftercareGuides.piercingType, like)
                )!
            );
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const baseQuery = db
            .select({
                id: aftercareGuides.id,
                handle: aftercareGuides.handle,
                title: aftercareGuides.title,
                piercingType: aftercareGuides.piercingType,
                healingMinWeeks: aftercareGuides.healingMinWeeks,
                healingMaxWeeks: aftercareGuides.healingMaxWeeks,
                iconUrl: aftercareGuides.iconUrl,
                serviceId: aftercareGuides.serviceId,
                version: aftercareGuides.version,
                isPublished: aftercareGuides.isPublished,
                createdAt: aftercareGuides.createdAt,
                updatedAt: aftercareGuides.updatedAt,
            })
            .from(aftercareGuides);

        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(asc(aftercareGuides.piercingType), asc(aftercareGuides.title))
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(aftercareGuides);
        const [{ total }] = await (where ? totalQuery.where(where) : totalQuery);

        return ok({
            guides: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/aftercare GET] failed", error);
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

    const parsed = await parseJson(req, createAftercareGuideSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    // Cross-field validation: max >= min when both supplied.
    if (
        input.healingMinWeeks != null &&
        input.healingMaxWeeks != null &&
        input.healingMaxWeeks < input.healingMinWeeks
    ) {
        return fail("healing_range_invalid", "healingMaxWeeks должен быть >= healingMinWeeks", {
            status: 400,
        });
    }

    try {
        const [existing] = await db
            .select({ id: aftercareGuides.id })
            .from(aftercareGuides)
            .where(eq(aftercareGuides.handle, input.handle))
            .limit(1);
        if (existing) {
            return fail("handle_in_use", "Слаг гайда уже используется", { status: 409 });
        }

        const [created] = await db
            .insert(aftercareGuides)
            .values({
                handle: input.handle,
                title: input.title,
                piercingType: input.piercingType,
                content: input.content,
                healingMinWeeks: input.healingMinWeeks ?? null,
                healingMaxWeeks: input.healingMaxWeeks ?? null,
                iconUrl: input.iconUrl ?? null,
                serviceId: input.serviceId ?? null,
                metaTitle: input.metaTitle ?? null,
                metaDescription: input.metaDescription ?? null,
                version: input.version ?? 1,
                isPublished: input.isPublished ?? true,
            })
            .returning();

        return ok({ guide: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг гайда уже используется", { status: 409 });
        }
        if (pgErrorCode(error) === "23503") {
            return fail("invalid_reference", "Несуществующая услуга", { status: 400 });
        }
        console.error("[/api/admin/aftercare POST] failed", error);
        return internal();
    }
}
