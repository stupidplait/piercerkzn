/**
 * /api/admin/blog/posts/[id]
 *
 *   GET    — full detail incl. category join.
 *   PATCH  — partial update. The first transition into `published` stamps
 *            `publishedAt = now()` (unless `scheduledAt` is in the future,
 *            in which case status is forced back to `draft`). Subsequent
 *            re-publishes preserve the original publish date.
 *   DELETE — soft (default: status='archived') or hard (?hard=true).
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
import { blogCategories, blogPosts, db } from "@/db";
import { updateBlogPostSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const [row] = await db
            .select({
                id: blogPosts.id,
                slug: blogPosts.slug,
                title: blogPosts.title,
                excerpt: blogPosts.excerpt,
                content: blogPosts.content,
                featuredImage: blogPosts.featuredImage,
                categoryId: blogPosts.categoryId,
                authorId: blogPosts.authorId,
                status: blogPosts.status,
                publishedAt: blogPosts.publishedAt,
                scheduledAt: blogPosts.scheduledAt,
                readTimeMin: blogPosts.readTimeMin,
                viewCount: blogPosts.viewCount,
                metaTitle: blogPosts.metaTitle,
                metaDescription: blogPosts.metaDescription,
                tags: blogPosts.tags,
                category: {
                    id: blogCategories.id,
                    handle: blogCategories.handle,
                    name: blogCategories.name,
                },
                createdAt: blogPosts.createdAt,
                updatedAt: blogPosts.updatedAt,
            })
            .from(blogPosts)
            .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
            .where(eq(blogPosts.id, id))
            .limit(1);
        if (!row) return notFound("Статья не найдена");
        return ok({ post: row });
    } catch (error) {
        console.error("[/api/admin/blog/posts/:id GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------
export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, updateBlogPostSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db.select().from(blogPosts).where(eq(blogPosts.id, id)).limit(1);
        if (!existing) return notFound("Статья не найдена");

        const now = new Date();
        const patch: Partial<typeof blogPosts.$inferInsert> = { updatedAt: now };

        if (input.slug !== undefined) patch.slug = input.slug;
        if (input.title !== undefined) patch.title = input.title;
        if (input.excerpt !== undefined) patch.excerpt = input.excerpt;
        if (input.content !== undefined) patch.content = input.content;
        if (input.featuredImage !== undefined) patch.featuredImage = input.featuredImage;
        if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
        if (input.authorId !== undefined) patch.authorId = input.authorId;
        if (input.scheduledAt !== undefined) patch.scheduledAt = input.scheduledAt;
        if (input.readTimeMin !== undefined) patch.readTimeMin = input.readTimeMin;
        if (input.metaTitle !== undefined) patch.metaTitle = input.metaTitle;
        if (input.metaDescription !== undefined) patch.metaDescription = input.metaDescription;
        if (input.tags !== undefined) patch.tags = input.tags;

        // Status / publishedAt logic: the first transition into `published`
        // stamps publishedAt; later draft↔published toggles preserve it.
        let publishedTransition = false;
        if (input.status !== undefined && input.status !== existing.status) {
            patch.status = input.status;

            if (input.status === "published") {
                const scheduled = input.scheduledAt ?? existing.scheduledAt;
                if (scheduled && scheduled.getTime() > now.getTime()) {
                    // Future-scheduled: keep as draft, sweeper will publish.
                    patch.status = "draft";
                } else if (existing.publishedAt === null) {
                    patch.publishedAt = now;
                    publishedTransition = true;
                }
            }
        }

        const [updated] = await db
            .update(blogPosts)
            .set(patch)
            .where(eq(blogPosts.id, id))
            .returning();

        return ok({ post: updated, publishedTransition });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("slug_in_use", "Слаг уже используется", { status: 409 });
        }
        if (pgErrorCode(error) === "23503") {
            return fail("invalid_reference", "Несуществующая категория или автор", { status: 400 });
        }
        console.error("[/api/admin/blog/posts/:id PATCH] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// DELETE — soft (status='archived') or hard
// ---------------------------------------------------------------------------
export async function DELETE(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const hard = url.searchParams.get("hard") === "true";

    try {
        const [existing] = await db
            .select({ id: blogPosts.id, status: blogPosts.status })
            .from(blogPosts)
            .where(eq(blogPosts.id, id))
            .limit(1);
        if (!existing) return notFound("Статья не найдена");

        if (hard) {
            await db.delete(blogPosts).where(eq(blogPosts.id, id));
            return ok({ deleted: true, mode: "hard" });
        }

        if (existing.status === "archived") {
            return ok({ deleted: true, mode: "soft", alreadyArchived: true });
        }

        const [updated] = await db
            .update(blogPosts)
            .set({ status: "archived", updatedAt: new Date() })
            .where(eq(blogPosts.id, id))
            .returning({ id: blogPosts.id, status: blogPosts.status });

        return ok({ deleted: true, mode: "soft", post: updated });
    } catch (error) {
        console.error("[/api/admin/blog/posts/:id DELETE] failed", error);
        return internal();
    }
}
