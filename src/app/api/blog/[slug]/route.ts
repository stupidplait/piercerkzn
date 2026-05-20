/**
 * GET /api/blog/[slug] — single published blog post.
 *
 * Side-effect: increments `view_count` (best-effort, fire-and-forget). The
 * value isn't authoritative — PostHog handles real engagement metrics.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";

import { internal, notFound, ok } from "@/lib/api";
import { blogCategories, blogPosts, db } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ slug: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
    const { slug } = await ctx.params;
    if (!slug || slug.length > 255) return notFound("Статья не найдена");

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
                publishedAt: blogPosts.publishedAt,
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
            .where(
                and(
                    eq(blogPosts.slug, slug),
                    eq(blogPosts.status, "published"),
                    isNotNull(blogPosts.publishedAt)
                )
            )
            .limit(1);
        if (!row) return notFound("Статья не найдена");

        // Best-effort view count bump — never blocks the response.
        void db
            .update(blogPosts)
            .set({ viewCount: sql`coalesce(${blogPosts.viewCount}, 0) + 1` })
            .where(eq(blogPosts.id, row.id))
            .catch((err) => console.error("[/api/blog/:slug] viewCount bump failed", err));

        return ok({ post: row });
    } catch (error) {
        console.error("[/api/blog/:slug] failed", error);
        return internal();
    }
}
