/**
 * GET /api/looks — published curated looks (paginated, filter by bodyArea).
 *
 * Backs the `/looks` gallery. Each card needs the headline pricing + a
 * thumbnail; the per-piece breakdown is on the detail endpoint.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { internal, ok, parseQuery } from "@/lib/api";
import { curatedLooks, db, lookPieces } from "@/db";
import { listLooksQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = parseQuery(url, listLooksQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [eq(curatedLooks.isPublished, true)];
        if (q.bodyArea) filters.push(eq(curatedLooks.bodyArea, q.bodyArea));
        const where = and(...filters);

        const rows = await db
            .select({
                id: curatedLooks.id,
                handle: curatedLooks.handle,
                title: curatedLooks.title,
                description: curatedLooks.description,
                bodyArea: curatedLooks.bodyArea,
                bodyModelId: curatedLooks.bodyModelId,
                thumbnailUrl: curatedLooks.thumbnailUrl,
                totalIndividualPrice: curatedLooks.totalIndividualPrice,
                bundlePrice: curatedLooks.bundlePrice,
                discountPercent: curatedLooks.discountPercent,
                currencyCode: curatedLooks.currencyCode,
                sortOrder: curatedLooks.sortOrder,
                pieceCount: sql<number>`(
                    select count(*) from ${lookPieces}
                    where ${lookPieces.lookId} = ${curatedLooks.id}
                )::int`,
            })
            .from(curatedLooks)
            .where(where)
            .orderBy(asc(curatedLooks.sortOrder), desc(curatedLooks.createdAt))
            .limit(q.limit)
            .offset(q.offset);

        const [{ total }] = await db
            .select({ total: sql<number>`count(*)::int` })
            .from(curatedLooks)
            .where(where);

        return ok({
            looks: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/looks GET] failed", error);
        return internal();
    }
}
