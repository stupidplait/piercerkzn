/**
 * GET /api/blog — paginated list of published blog posts.
 *
 * Filters: `category` (handle), `tag`. Sort: newest (default) | oldest | popular.
 * Backs `/blog` index. Body content is omitted from the list response —
 * the storefront fetches it on the detail page.
 */
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";

import { internal, ok, parseQuery } from "@/lib/api";
import { blogCategories, blogPosts, db } from "@/db";
import { listBlogQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = parseQuery(url, listBlogQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [eq(blogPosts.status, "published"), isNotNull(blogPosts.publishedAt)];
        if (q.category) filters.push(eq(blogCategories.handle, q.category));
        if (q.tag) {
            // tags is text[]; check membership.
            filters.push(sql`${q.tag} = ANY(${blogPosts.tags})`);
        }
        const where = and(...filters);

        const orderBy =
            q.sort === "popular"
                ? [desc(blogPosts.viewCount), desc(blogPosts.publishedAt)]
                : q.sort === "oldest"
                  ? [asc(blogPosts.publishedAt)]
                  : [desc(blogPosts.publishedAt)];

        const rows = await db
            .select({
                id: blogPosts.id,
                slug: blogPosts.slug,
                title: blogPosts.title,
                excerpt: blogPosts.excerpt,
                featuredImage: blogPosts.featuredImage,
                readTimeMin: blogPosts.readTimeMin,
                viewCount: blogPosts.viewCount,
                tags: blogPosts.tags,
                publishedAt: blogPosts.publishedAt,
                category: {
                    id: blogCategories.id,
                    handle: blogCategories.handle,
                    name: blogCategories.name,
                },
            })
            .from(blogPosts)
            .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
            .where(where)
            .orderBy(...orderBy)
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db
            .select({ total: sql<number>`count(*)::int` })
            .from(blogPosts)
            .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId));
        const totalRow = await totalQuery.where(where).then((r) => r[0]);

        return ok({
            posts: rows,
            count: rows.length,
            total: totalRow.total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/blog GET] failed", error);
        return internal();
    }
}
