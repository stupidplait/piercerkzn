/**
 * /api/admin/portfolio — admin portfolio image management.
 *
 *   GET  — list, ordered by (sortOrder ASC, createdAt DESC). Includes rows
 *          with `clientConsent = false` (those are hidden from the public
 *          `/api/piercer/portfolio` route). Optional `?piercingType=` filter.
 *   POST — create.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";

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
import { db, portfolioImages } from "@/db";
import { adminListPortfolioImagesQuerySchema, createPortfolioImageSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, adminListPortfolioImagesQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.piercingType) filters.push(eq(portfolioImages.piercingType, q.piercingType));
        const where = filters.length > 0 ? and(...filters) : undefined;

        const baseQuery = db
            .select({
                id: portfolioImages.id,
                imageUrl: portfolioImages.imageUrl,
                thumbnailUrl: portfolioImages.thumbnailUrl,
                piercingType: portfolioImages.piercingType,
                productId: portfolioImages.productId,
                description: portfolioImages.description,
                clientConsent: portfolioImages.clientConsent,
                sortOrder: portfolioImages.sortOrder,
                createdAt: portfolioImages.createdAt,
            })
            .from(portfolioImages);

        const rows = await (where ? baseQuery.where(where) : baseQuery).orderBy(
            asc(portfolioImages.sortOrder),
            desc(portfolioImages.createdAt)
        );

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(portfolioImages);
        const totalRow = await (where ? totalQuery.where(where) : totalQuery).then((r) => r[0]);

        return ok({
            images: rows,
            count: rows.length,
            total: totalRow.total,
        });
    } catch (error) {
        console.error("[/api/admin/portfolio GET] failed", error);
        return internal();
    }
}

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createPortfolioImageSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [created] = await db
            .insert(portfolioImages)
            .values({
                imageUrl: input.imageUrl,
                thumbnailUrl: input.thumbnailUrl ?? null,
                piercingType: input.piercingType ?? null,
                productId: input.productId ?? null,
                description: input.description ?? null,
                clientConsent: input.clientConsent ?? true,
                sortOrder: input.sortOrder ?? 0,
            })
            .returning();

        return ok({ image: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23503") {
            return fail("product_not_found", "Товар не найден", { status: 400 });
        }
        console.error("[/api/admin/portfolio POST] failed", error);
        return internal();
    }
}
