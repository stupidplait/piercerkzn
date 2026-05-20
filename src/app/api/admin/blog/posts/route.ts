/**
 * /api/admin/blog/posts
 *
 *   GET  — list (filterable by status / category / tag / search).
 *   POST — create. `status='published'` stamps `publishedAt = now()`
 *          unless the caller passes a `scheduledAt` in the future, in
 *          which case status is forced back to `draft` and the sweeper
 *          will publish at the scheduled time.
 *
 * Slug uniqueness enforced by the DB; pre-flight check returns 409.
 */
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";

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
import { blogCategories, blogPosts, db } from "@/db";
import { adminListBlogPostsQuerySchema, createBlogPostSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------
export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, adminListBlogPostsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.status) filters.push(eq(blogPosts.status, q.status));
        if (q.categoryId) filters.push(eq(blogPosts.categoryId, q.categoryId));
        if (q.tag) {
            filters.push(sql`${q.tag} = ANY(${blogPosts.tags})`);
        }
        if (q.search) {
            const like = `%${q.search}%`;
            filters.push(or(ilike(blogPosts.title, like), ilike(blogPosts.slug, like))!);
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const orderBy = (() => {
            switch (q.sort) {
                case "oldest":
                    return [asc(blogPosts.createdAt)];
                case "popular":
                    return [desc(blogPosts.viewCount), desc(blogPosts.createdAt)];
                case "scheduled":
                    return [asc(blogPosts.scheduledAt), desc(blogPosts.createdAt)];
                case "newest":
                default:
                    return [desc(blogPosts.createdAt)];
            }
        })();

        const baseQuery = db
            .select({
                id: blogPosts.id,
                slug: blogPosts.slug,
                title: blogPosts.title,
                excerpt: blogPosts.excerpt,
                featuredImage: blogPosts.featuredImage,
                status: blogPosts.status,
                publishedAt: blogPosts.publishedAt,
                scheduledAt: blogPosts.scheduledAt,
                viewCount: blogPosts.viewCount,
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
            .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId));

        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(...orderBy)
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(blogPosts);
        const [{ total }] = await (where ? totalQuery.where(where) : totalQuery);

        return ok({
            posts: rows,
            count: rows.length,
            total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/blog/posts GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// POST — create
// ---------------------------------------------------------------------------
export async function POST(req: Request) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const parsed = await parseJson(req, createBlogPostSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const [existing] = await db
            .select({ id: blogPosts.id })
            .from(blogPosts)
            .where(eq(blogPosts.slug, input.slug))
            .limit(1);
        if (existing) {
            return fail("slug_in_use", "Слаг уже используется", { status: 409 });
        }

        const now = new Date();
        let status = input.status;
        let publishedAt: Date | null = null;

        if (status === "published") {
            // Scheduled-in-the-future overrides immediate publish.
            if (input.scheduledAt && input.scheduledAt.getTime() > now.getTime()) {
                status = "draft";
            } else {
                publishedAt = now;
            }
        }

        const [created] = await db
            .insert(blogPosts)
            .values({
                slug: input.slug,
                title: input.title,
                excerpt: input.excerpt ?? null,
                content: input.content,
                featuredImage: input.featuredImage ?? null,
                categoryId: input.categoryId ?? null,
                authorId: input.authorId ?? null,
                status,
                publishedAt,
                scheduledAt: input.scheduledAt ?? null,
                readTimeMin: input.readTimeMin ?? null,
                metaTitle: input.metaTitle ?? null,
                metaDescription: input.metaDescription ?? null,
                tags: input.tags ?? null,
            })
            .returning();

        return ok({ post: created }, { status: 201 });
    } catch (error: unknown) {
        if (pgErrorCode(error) === "23505") {
            return fail("slug_in_use", "Слаг уже используется", { status: 409 });
        }
        if (pgErrorCode(error) === "23503") {
            return fail("invalid_reference", "Несуществующая категория или автор", { status: 400 });
        }
        console.error("[/api/admin/blog/posts POST] failed", error);
        return internal();
    }
}
