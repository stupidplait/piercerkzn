/**
 * /api/admin/portfolio/[id]
 *
 *   GET    — single portfolio image.
 *   PATCH  — partial update.
 *   DELETE — hard delete. No referencing tables, so no guard needed.
 */
import { eq } from "drizzle-orm";

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
import { db, portfolioImages } from "@/db";
import { updatePortfolioImageSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [row] = await db
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
            .from(portfolioImages)
            .where(eq(portfolioImages.id, id))
            .limit(1);
        if (!row) return notFound("Изображение не найдено");

        return ok({ image: row });
    } catch (error) {
        console.error("[/api/admin/portfolio/:id GET] failed", error);
        return internal();
    }
}

export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updatePortfolioImageSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: portfolioImages.id })
            .from(portfolioImages)
            .where(eq(portfolioImages.id, id))
            .limit(1);
        if (!existing) return notFound("Изображение не найдено");

        const patch: Partial<typeof portfolioImages.$inferInsert> = {};
        if (input.imageUrl !== undefined) patch.imageUrl = input.imageUrl;
        if (input.thumbnailUrl !== undefined) patch.thumbnailUrl = input.thumbnailUrl;
        if (input.piercingType !== undefined) patch.piercingType = input.piercingType;
        if (input.productId !== undefined) patch.productId = input.productId;
        if (input.description !== undefined) patch.description = input.description;
        if (input.clientConsent !== undefined) patch.clientConsent = input.clientConsent;
        if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

        const [updated] = await db
            .update(portfolioImages)
            .set(patch)
            .where(eq(portfolioImages.id, id))
            .returning();

        return ok({ image: updated });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23503") {
            return fail("product_not_found", "Товар не найден", { status: 400 });
        }
        console.error("[/api/admin/portfolio/:id PATCH] failed", error);
        return internal();
    }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [existing] = await db
            .select({ id: portfolioImages.id })
            .from(portfolioImages)
            .where(eq(portfolioImages.id, id))
            .limit(1);
        if (!existing) return notFound("Изображение не найдено");

        await db.delete(portfolioImages).where(eq(portfolioImages.id, id));
        return ok({ deleted: true });
    } catch (error) {
        console.error("[/api/admin/portfolio/:id DELETE] failed", error);
        return internal();
    }
}
