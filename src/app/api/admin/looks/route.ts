/**
 * /api/admin/looks
 *
 *   GET  — list curated looks (admin: includes unpublished).
 *   POST — create. `body_area` is auto-filled from the body model when
 *          the caller omits it. `total_individual_price` defaults to 0
 *          and is rewritten by the pieces routes as items are added.
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
import { bodyModels, curatedLooks, db, lookPieces } from "@/db";
import { adminListCuratedLooksQuerySchema, createCuratedLookSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, adminListCuratedLooksQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.bodyArea) filters.push(eq(curatedLooks.bodyArea, q.bodyArea));
        if (q.bodyModelId) filters.push(eq(curatedLooks.bodyModelId, q.bodyModelId));
        if (q.isPublished !== undefined) filters.push(eq(curatedLooks.isPublished, q.isPublished));
        if (q.search) {
            const like = `%${q.search}%`;
            filters.push(or(ilike(curatedLooks.title, like), ilike(curatedLooks.handle, like))!);
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const orderBy = (() => {
            switch (q.sort) {
                case "newest":
                    return [desc(curatedLooks.createdAt)];
                case "oldest":
                    return [asc(curatedLooks.createdAt)];
                case "discount":
                    return [desc(curatedLooks.discountPercent), desc(curatedLooks.createdAt)];
                case "sortOrder":
                default:
                    return [asc(curatedLooks.sortOrder), desc(curatedLooks.createdAt)];
            }
        })();

        const baseQuery = db
            .select({
                id: curatedLooks.id,
                handle: curatedLooks.handle,
                title: curatedLooks.title,
                description: curatedLooks.description,
                bodyModelId: curatedLooks.bodyModelId,
                bodyArea: curatedLooks.bodyArea,
                thumbnailUrl: curatedLooks.thumbnailUrl,
                totalIndividualPrice: curatedLooks.totalIndividualPrice,
                bundlePrice: curatedLooks.bundlePrice,
                discountPercent: curatedLooks.discountPercent,
                currencyCode: curatedLooks.currencyCode,
                isPublished: curatedLooks.isPublished,
                sortOrder: curatedLooks.sortOrder,
                createdAt: curatedLooks.createdAt,
                updatedAt: curatedLooks.updatedAt,
                pieceCount: sql<number>`(
                    select count(*)::int from ${lookPieces}
                    where ${lookPieces.lookId} = ${sql.raw('"curated_look"."id"')}
                )`,
            })
            .from(curatedLooks);

        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(...orderBy)
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(curatedLooks);
        const [{ total }] = await (where ? totalQuery.where(where) : totalQuery);

        return ok({
            looks: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/looks GET] failed", error);
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

    const parsed = await parseJson(req, createCuratedLookSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        // Pre-flight: handle uniqueness + body model existence (and pull
        // `area` so we can auto-fill `body_area` when the caller omits it).
        const [existing] = await db
            .select({ id: curatedLooks.id })
            .from(curatedLooks)
            .where(eq(curatedLooks.handle, input.handle))
            .limit(1);
        if (existing) {
            return fail("handle_in_use", "Слаг сета уже используется", { status: 409 });
        }

        const [model] = await db
            .select({ id: bodyModels.id, area: bodyModels.area })
            .from(bodyModels)
            .where(eq(bodyModels.id, input.bodyModelId))
            .limit(1);
        if (!model) {
            return fail("body_model_not_found", "3D модель не найдена", { status: 400 });
        }

        const bodyArea = input.bodyArea ?? model.area;

        const [created] = await db
            .insert(curatedLooks)
            .values({
                handle: input.handle,
                title: input.title,
                description: input.description ?? null,
                bodyModelId: input.bodyModelId,
                bodyArea,
                thumbnailUrl: input.thumbnailUrl ?? null,
                bundlePrice: input.bundlePrice,
                totalIndividualPrice: input.totalIndividualPrice ?? 0,
                currencyCode: input.currencyCode ?? "rub",
                cameraState: input.cameraState ?? null,
                isPublished: input.isPublished ?? false,
                sortOrder: input.sortOrder ?? 0,
            })
            .returning();

        return ok({ look: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг сета уже используется", { status: 409 });
        }
        console.error("[/api/admin/looks POST] failed", error);
        return internal();
    }
}
