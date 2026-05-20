import type { Metadata } from "next";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db, blogCategories, blogPosts } from "@/db";

import { type BlogCategory as BlogCategoryType } from "./BlogFilters";
import { type BlogPostCardData } from "./BlogPostCard";
import { BlogContent } from "./BlogContent";
import styles from "./blog.module.css";

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
    title: "Блог — PiercerKZN",
    description:
        "Статьи о пирсинге, уходе за проколами и ювелирных украшениях. Советы от профессионального пирсера из Казани.",
    openGraph: {
        title: "Блог — PiercerKZN",
        description: "Статьи о пирсинге, уходе за проколами и ювелирных украшениях.",
        url: "https://piercerkzn.ru/blog",
        type: "website",
    },
    twitter: {
        card: "summary",
        title: "Блог — PiercerKZN",
        description: "Статьи о пирсинге, уходе за проколами и ювелирных украшениях.",
    },
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const PAGE_SIZE = 9;

type SortOption = "newest" | "oldest" | "popular";
const VALID_SORTS: SortOption[] = ["newest", "oldest", "popular"];

// ---------------------------------------------------------------------------
// Server Component
// ---------------------------------------------------------------------------

interface BlogPageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function BlogPage({ searchParams }: BlogPageProps) {
    const params = await searchParams;

    // Parse query params
    const categoryHandle = typeof params.category === "string" ? params.category : undefined;
    const tag = typeof params.tag === "string" ? params.tag : undefined;
    const sortParam = typeof params.sort === "string" ? params.sort : "newest";
    const sort: SortOption = VALID_SORTS.includes(sortParam as SortOption)
        ? (sortParam as SortOption)
        : "newest";
    const page = typeof params.page === "string" ? Math.max(1, parseInt(params.page, 10) || 1) : 1;
    const offset = (page - 1) * PAGE_SIZE;

    // Fetch categories, posts, and all tags in parallel
    const [categories, { posts, total }, allTags] = await Promise.all([
        fetchCategories(),
        fetchBlogPosts({ categoryHandle, tag, sort, limit: PAGE_SIZE, offset }),
        fetchAllTags(),
    ]);

    const totalPages = Math.ceil(total / PAGE_SIZE);

    return (
        <div className={styles.blogPage}>
            <header className={styles.blogHeader}>
                <h1 className={styles.blogTitle}>Блог</h1>
                <p className={styles.blogSubtitle}>
                    Статьи о пирсинге, украшениях и уходе за проколами
                </p>
            </header>

            <BlogContent
                categories={categories}
                allTags={allTags}
                initialPosts={posts}
                initialTotal={total}
                initialTotalPages={totalPages}
                initialPage={page}
            />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function fetchCategories(): Promise<BlogCategoryType[]> {
    const rows = await db
        .select({
            id: blogCategories.id,
            handle: blogCategories.handle,
            name: blogCategories.name,
        })
        .from(blogCategories)
        .orderBy(asc(blogCategories.sortOrder), asc(blogCategories.name));

    return rows;
}

interface FetchBlogParams {
    categoryHandle?: string;
    tag?: string;
    sort: SortOption;
    limit: number;
    offset: number;
}

async function fetchBlogPosts(
    params: FetchBlogParams
): Promise<{ posts: BlogPostCardData[]; total: number }> {
    const { categoryHandle, tag, sort, limit, offset } = params;

    // Build WHERE conditions
    const filters = [eq(blogPosts.status, "published")];

    // Category filter: resolve handle → id via subquery
    if (categoryHandle) {
        const catSubquery = db
            .select({ id: blogCategories.id })
            .from(blogCategories)
            .where(eq(blogCategories.handle, categoryHandle));
        filters.push(sql`${blogPosts.categoryId} IN (${catSubquery})`);
    }

    // Tag filter: array contains
    if (tag) {
        filters.push(sql`${tag} = ANY(${blogPosts.tags})`);
    }

    // Sort clause
    const sortClause = (() => {
        switch (sort) {
            case "newest":
                return desc(blogPosts.publishedAt);
            case "oldest":
                return asc(blogPosts.publishedAt);
            case "popular":
                return desc(blogPosts.viewCount);
            default:
                return desc(blogPosts.publishedAt);
        }
    })();

    // Execute query + count in parallel
    const [rows, countResult] = await Promise.all([
        db
            .select({
                slug: blogPosts.slug,
                title: blogPosts.title,
                excerpt: blogPosts.excerpt,
                featuredImage: blogPosts.featuredImage,
                readTimeMin: blogPosts.readTimeMin,
                publishedAt: blogPosts.publishedAt,
            })
            .from(blogPosts)
            .where(and(...filters))
            .orderBy(sortClause)
            .limit(limit)
            .offset(offset),
        db
            .select({ total: sql<number>`count(*)::int` })
            .from(blogPosts)
            .where(and(...filters)),
    ]);

    return {
        posts: rows.map((row) => ({
            slug: row.slug,
            title: row.title,
            excerpt: row.excerpt,
            featuredImage: row.featuredImage,
            readTimeMin: row.readTimeMin,
            publishedAt: row.publishedAt,
        })),
        total: countResult[0]?.total ?? 0,
    };
}

async function fetchAllTags(): Promise<string[]> {
    // Get distinct tags from all published posts
    const rows = await db
        .select({ tags: blogPosts.tags })
        .from(blogPosts)
        .where(eq(blogPosts.status, "published"));

    const tagSet = new Set<string>();
    for (const row of rows) {
        if (row.tags && Array.isArray(row.tags)) {
            for (const t of row.tags) {
                if (t) tagSet.add(t);
            }
        }
    }

    return Array.from(tagSet).sort();
}
