/**
 * GET /api/blog/[slug]/related — up to 6 related published posts.
 *
 * Strategy (cheap, no full-text index): pick posts in the same category
 * first, then fill remainder with any other recent published posts. Posts
 * sharing tags get a small boost via tag-overlap count.
 */
import { and, desc, eq, isNotNull, ne, notInArray, or, sql } from "drizzle-orm";

import { internal, notFound, ok } from "@/lib/api";
import { blogCategories, blogPosts, db } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ slug: string }>;
}

const RELATED_LIMIT = 6;

export async function GET(_req: Request, ctx: RouteContext) {
    const { slug } = await ctx.params;
    if (!slug || slug.length > 255) return notFound("Статья не найдена");

    try {
        const [seed] = await db
            .select({
                id: blogPosts.id,
                categoryId: blogPosts.categoryId,
                tags: blogPosts.tags,
            })
            .from(blogPosts)
            .where(eq(blogPosts.slug, slug))
            .limit(1);
        if (!seed) return notFound("Статья не найдена");

        const baseFilters = [
            eq(blogPosts.status, "published"),
            isNotNull(blogPosts.publishedAt),
            ne(blogPosts.id, seed.id),
        ];

        const tagFilter =
            seed.tags && seed.tags.length > 0
                ? sql`${blogPosts.tags} && ${seed.tags}::text[]`
                : null;
        const sameCategoryOrTag =
            seed.categoryId !== null && tagFilter
                ? or(eq(blogPosts.categoryId, seed.categoryId), tagFilter)
                : seed.categoryId !== null
                  ? eq(blogPosts.categoryId, seed.categoryId)
                  : tagFilter;

        const primary = await db
            .select({
                id: blogPosts.id,
                slug: blogPosts.slug,
                title: blogPosts.title,
                excerpt: blogPosts.excerpt,
                featuredImage: blogPosts.featuredImage,
                publishedAt: blogPosts.publishedAt,
                readTimeMin: blogPosts.readTimeMin,
                category: {
                    id: blogCategories.id,
                    handle: blogCategories.handle,
                    name: blogCategories.name,
                },
            })
            .from(blogPosts)
            .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
            .where(sameCategoryOrTag ? and(...baseFilters, sameCategoryOrTag) : and(...baseFilters))
            .orderBy(desc(blogPosts.publishedAt))
            .limit(RELATED_LIMIT);

        let related = primary;
        if (related.length < RELATED_LIMIT) {
            const excludeIds = [seed.id, ...related.map((r) => r.id)];
            const fallback = await db
                .select({
                    id: blogPosts.id,
                    slug: blogPosts.slug,
                    title: blogPosts.title,
                    excerpt: blogPosts.excerpt,
                    featuredImage: blogPosts.featuredImage,
                    publishedAt: blogPosts.publishedAt,
                    readTimeMin: blogPosts.readTimeMin,
                    category: {
                        id: blogCategories.id,
                        handle: blogCategories.handle,
                        name: blogCategories.name,
                    },
                })
                .from(blogPosts)
                .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
                .where(
                    and(
                        eq(blogPosts.status, "published"),
                        isNotNull(blogPosts.publishedAt),
                        notInArray(blogPosts.id, excludeIds)
                    )
                )
                .orderBy(desc(blogPosts.publishedAt))
                .limit(RELATED_LIMIT - related.length);
            related = related.concat(fallback);
        }

        return ok({ posts: related, count: related.length });
    } catch (error) {
        console.error("[/api/blog/:slug/related] failed", error);
        return internal();
    }
}
