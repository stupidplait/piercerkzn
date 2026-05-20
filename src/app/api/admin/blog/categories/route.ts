/**
 * /api/admin/blog/categories
 *
 *   GET  — list categories with post counts.
 *   POST — create.
 *
 * Categories are referenced by `blog_post.category_id` (nullable, no cascade).
 * Deleting a category that still has posts is rejected by the per-id route.
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
import { blogCategories, blogPosts, db } from "@/db";
import { createBlogCategorySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const rows = await db
            .select({
                id: blogCategories.id,
                handle: blogCategories.handle,
                name: blogCategories.name,
                sortOrder: blogCategories.sortOrder,
                createdAt: blogCategories.createdAt,
                // Subquery is correlated to the outer `blog_category.id`.
                // We embed the qualified column literal explicitly because
                // Drizzle's column interpolation strips the table prefix
                // inside `select({...})`-scoped sql templates, which causes
                // Postgres to resolve `"id"` to the inner `blog_post.id`
                // instead of the outer `blog_category.id` and silently
                // returns count = 0.
                postCount: sql<number>`(
                    select count(*)::int from ${blogPosts}
                    where ${blogPosts.categoryId} = ${sql.raw('"blog_category"."id"')}
                )`,
            })
            .from(blogCategories)
            .orderBy(asc(blogCategories.sortOrder), asc(blogCategories.name));

        return ok({ categories: rows, count: rows.length });
    } catch (error) {
        console.error("[/api/admin/blog/categories GET] failed", error);
        return internal();
    }
}

export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createBlogCategorySchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: blogCategories.id })
            .from(blogCategories)
            .where(eq(blogCategories.handle, input.handle))
            .limit(1);
        if (existing) {
            return fail("handle_in_use", "Слаг категории уже используется", { status: 409 });
        }

        const [created] = await db
            .insert(blogCategories)
            .values({
                handle: input.handle,
                name: input.name,
                sortOrder: input.sortOrder ?? 0,
            })
            .returning();

        return ok({ category: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг категории уже используется", { status: 409 });
        }
        console.error("[/api/admin/blog/categories POST] failed", error);
        return internal();
    }
}
