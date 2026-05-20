/**
 * GET /api/piercer/portfolio — gallery of healed work for the `/about` page.
 *
 * Returns only images with `clientConsent = true`. Optional filter by
 * `piercingType` (e.g. `helix`, `septum`). Sort: `sortOrder ASC, createdAt DESC`.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { internal, ok, parseQuery } from "@/lib/api";
import { db, portfolioImages } from "@/db";
import { piercerPortfolioQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = parseQuery(url, piercerPortfolioQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [eq(portfolioImages.clientConsent, true)];
        if (q.piercingType) filters.push(eq(portfolioImages.piercingType, q.piercingType));
        const where = and(...filters);

        const rows = await db
            .select({
                id: portfolioImages.id,
                imageUrl: portfolioImages.imageUrl,
                thumbnailUrl: portfolioImages.thumbnailUrl,
                piercingType: portfolioImages.piercingType,
                productId: portfolioImages.productId,
                description: portfolioImages.description,
                sortOrder: portfolioImages.sortOrder,
                createdAt: portfolioImages.createdAt,
            })
            .from(portfolioImages)
            .where(where)
            .orderBy(asc(portfolioImages.sortOrder), desc(portfolioImages.createdAt))
            .limit(q.limit)
            .offset(q.offset);

        const [{ total }] = await db
            .select({ total: sql<number>`count(*)::int` })
            .from(portfolioImages)
            .where(where);

        return ok({
            images: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/piercer/portfolio] failed", error);
        return internal();
    }
}
