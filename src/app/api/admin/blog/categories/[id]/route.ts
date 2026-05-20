/**
 * /api/admin/blog/categories/[id]
 *
 *   GET    — single category + post count.
 *   PATCH  — partial update.
 *   DELETE — hard delete. Refused with 409 if any blog_post still references it
 *            (since `blog_post.category_id` has no cascade or set-null).
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
import { blogCategories, blogPosts, db } from "@/db";
import { updateBlogCategorySchema } from "@/lib/validations";

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
                id: blogCategories.id,
                handle: blogCategories.handle,
                name: blogCategories.name,
                sortOrder: blogCategories.sortOrder,
                createdAt: blogCategories.createdAt,
            })
            .from(blogCategories)
            .where(eq(blogCategories.id, id))
            .limit(1);
        if (!row) return notFound("Категория не найдена");

        const [{ postCount }] = await db
            .select({ postCount: sql<number>`count(*)::int` })
            .from(blogPosts)
            .where(eq(blogPosts.categoryId, id));

        return ok({ category: { ...row, postCount } });
    } catch (error) {
        console.error("[/api/admin/blog/categories/:id GET] failed", error);
        return internal();
    }
}

export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updateBlogCategorySchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: blogCategories.id })
            .from(blogCategories)
            .where(eq(blogCategories.id, id))
            .limit(1);
        if (!existing) return notFound("Категория не найдена");

        const patch: Partial<typeof blogCategories.$inferInsert> = {};
        if (input.handle !== undefined) patch.handle = input.handle;
        if (input.name !== undefined) patch.name = input.name;
        if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;

        const [updated] = await db
            .update(blogCategories)
            .set(patch)
            .where(eq(blogCategories.id, id))
            .returning();

        return ok({ category: updated });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("handle_in_use", "Слаг категории уже используется", { status: 409 });
        }
        console.error("[/api/admin/blog/categories/:id PATCH] failed", error);
        return internal();
    }
}

export async function DELETE(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [existing] = await db
            .select({ id: blogCategories.id })
            .from(blogCategories)
            .where(eq(blogCategories.id, id))
            .limit(1);
        if (!existing) return notFound("Категория не найдена");

        const [{ postCount }] = await db
            .select({ postCount: sql<number>`count(*)::int` })
            .from(blogPosts)
            .where(eq(blogPosts.categoryId, id));
        if (postCount > 0) {
            return fail(
                "category_in_use",
                `К категории привязано ${postCount} статей. Сначала переназначьте их.`,
                { status: 409 }
            );
        }

        await db.delete(blogCategories).where(eq(blogCategories.id, id));
        return ok({ deleted: true });
    } catch (error) {
        console.error("[/api/admin/blog/categories/:id DELETE] failed", error);
        return internal();
    }
}
