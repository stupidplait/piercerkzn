/**
 * /api/admin/categories/[id]
 *
 *   GET    — single category + product count.
 *   PATCH  — partial update.
 *   DELETE — hard delete. Refused with 409 if any product still references it
 *            (since `product.category_id` has no cascade or set-null).
 */
import { eq, sql } from "drizzle-orm";

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
import { db, productCategories, products } from "@/db";
import { invalidateCatalogCache } from "@/lib/products/catalog-cache";
import { updateProductCategorySchema } from "@/lib/validations";

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
                id: productCategories.id,
                handle: productCategories.handle,
                name: productCategories.name,
                description: productCategories.description,
                parentId: productCategories.parentId,
                imageUrl: productCategories.imageUrl,
                sortOrder: productCategories.sortOrder,
                isActive: productCategories.isActive,
                createdAt: productCategories.createdAt,
                updatedAt: productCategories.updatedAt,
            })
            .from(productCategories)
            .where(eq(productCategories.id, id))
            .limit(1);
        if (!row) return notFound("Категория не найдена");

        const [{ productCount }] = await db
            .select({ productCount: sql<number>`count(*)::int` })
            .from(products)
            .where(eq(products.categoryId, id));

        return ok({ category: { ...row, productCount } });
    } catch (error) {
        console.error("[/api/admin/categories/:id GET] failed", error);
        return internal();
    }
}

export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updateProductCategorySchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: productCategories.id })
            .from(productCategories)
            .where(eq(productCategories.id, id))
            .limit(1);
        if (!existing) return notFound("Категория не найдена");

        const patch: Partial<typeof productCategories.$inferInsert> = {
            updatedAt: new Date(),
        };
        if (input.handle !== undefined) patch.handle = input.handle;
        if (input.name !== undefined) patch.name = input.name;
        if (input.description !== undefined) patch.description = input.description;
        if (input.parentId !== undefined) patch.parentId = input.parentId;
        if (input.imageUrl !== undefined) patch.imageUrl = input.imageUrl;
        if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
        if (input.isActive !== undefined) patch.isActive = input.isActive;

        const [updated] = await db
            .update(productCategories)
            .set(patch)
            .where(eq(productCategories.id, id))
            .returning();

        void invalidateCatalogCache().catch((err) =>
            console.warn("[admin.categories PATCH] cache invalidate failed", err)
        );

        return ok({ category: updated });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг категории уже используется", { status: 409 });
        }
        if (pgErrorCode(error) === "23503") {
            return fail("parent_not_found", "Родительская категория не найдена", {
                status: 400,
            });
        }
        console.error("[/api/admin/categories/:id PATCH] failed", error);
        return internal();
    }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [existing] = await db
            .select({ id: productCategories.id })
            .from(productCategories)
            .where(eq(productCategories.id, id))
            .limit(1);
        if (!existing) return notFound("Категория не найдена");

        const [{ productCount }] = await db
            .select({ productCount: sql<number>`count(*)::int` })
            .from(products)
            .where(eq(products.categoryId, id));
        if (productCount > 0) {
            return fail("category_in_use", "К категории привязаны товары — отвяжите их сначала", {
                status: 409,
            });
        }

        await db.delete(productCategories).where(eq(productCategories.id, id));

        void invalidateCatalogCache().catch((err) =>
            console.warn("[admin.categories DELETE] cache invalidate failed", err)
        );

        return ok({ deleted: true });
    } catch (error) {
        console.error("[/api/admin/categories/:id DELETE] failed", error);
        return internal();
    }
}
