/**
 * GET /api/categories/[handle] — single category lookup with the count of
 * published products it contains. Backs `/catalog/[handle]` SEO pages.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { internal, notFound, ok } from "@/lib/api";
import { db, productCategories, products } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ handle: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
    const { handle } = await ctx.params;
    if (!handle || handle.length > 100) return notFound("Категория не найдена");

    try {
        const [row] = await db
            .select({
                id: productCategories.id,
                handle: productCategories.handle,
                name: productCategories.name,
                description: productCategories.description,
                imageUrl: productCategories.imageUrl,
                parentId: productCategories.parentId,
                sortOrder: productCategories.sortOrder,
                createdAt: productCategories.createdAt,
                updatedAt: productCategories.updatedAt,
            })
            .from(productCategories)
            .where(and(eq(productCategories.handle, handle), eq(productCategories.isActive, true)))
            .limit(1);

        if (!row) return notFound("Категория не найдена");

        const [{ productCount }] = await db
            .select({ productCount: sql<number>`count(*)::int` })
            .from(products)
            .where(
                and(
                    eq(products.categoryId, row.id),
                    eq(products.status, "published"),
                    isNull(products.deletedAt)
                )
            );

        return ok({ category: { ...row, productCount } });
    } catch (error) {
        console.error("[/api/categories/:handle] failed", error);
        return internal();
    }
}
