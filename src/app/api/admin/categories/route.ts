/**
 * /api/admin/categories — admin product-category management.
 *
 *   GET  — list all categories (active and inactive), ordered by
 *          (sortOrder ASC, name ASC).
 *   POST — create.
 *
 * Categories are referenced by `product.category_id` (nullable, no cascade);
 * deleting a category that still has products is rejected by the per-id
 * route. The public storefront calls `getActiveCategoriesCached()`; admin
 * write paths bust that cache via `invalidateCatalogCache()`.
 */
import { asc, eq, sql } from "drizzle-orm";

import {
    applyRateLimit,
    fail,
    internal,
    ok,
    parseJson,
    pgErrorCode,
    requireAdmin,
} from "@/lib/api";
import { db, productCategories, products } from "@/db";
import { invalidateCatalogCache } from "@/lib/products/catalog-cache";
import { createProductCategorySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const rows = await db
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
                // Subquery is correlated to the outer `product_category.id`.
                // We embed the qualified column literal explicitly because
                // Drizzle's column interpolation strips the table prefix
                // inside `select({...})`-scoped sql templates, which causes
                // Postgres to resolve `"id"` to the inner `product.id`
                // instead of the outer `product_category.id` and silently
                // returns count = 0.
                productCount: sql<number>`(
                    select count(*)::int from ${products}
                    where ${products.categoryId} = ${sql.raw('"product_category"."id"')}
                )`,
            })
            .from(productCategories)
            .orderBy(asc(productCategories.sortOrder), asc(productCategories.name));

        return ok({ categories: rows, count: rows.length });
    } catch (error) {
        console.error("[/api/admin/categories GET] failed", error);
        return internal();
    }
}

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createProductCategorySchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: productCategories.id })
            .from(productCategories)
            .where(eq(productCategories.handle, input.handle))
            .limit(1);
        if (existing) {
            return fail("handle_in_use", "Слаг категории уже используется", { status: 409 });
        }

        const [created] = await db
            .insert(productCategories)
            .values({
                handle: input.handle,
                name: input.name,
                description: input.description ?? null,
                parentId: input.parentId ?? null,
                imageUrl: input.imageUrl ?? null,
                sortOrder: input.sortOrder ?? 0,
                isActive: input.isActive ?? true,
            })
            .returning();

        // Storefront category list is cached read-through; bust on any write.
        void invalidateCatalogCache().catch((err) =>
            console.warn("[admin.categories POST] cache invalidate failed", err)
        );

        return ok({ category: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг категории уже используется", { status: 409 });
        }
        if (pgErrorCode(error) === "23503") {
            return fail("parent_not_found", "Родительская категория не найдена", {
                status: 400,
            });
        }
        console.error("[/api/admin/categories POST] failed", error);
        return internal();
    }
}
