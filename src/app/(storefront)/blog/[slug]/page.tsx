/**
 * Blog Post Page — /blog/[slug]
 *
 * Server Component that fetches a published blog post by slug, increments
 * the view count (fire-and-forget), and renders the full content with
 * metadata, author info, category, and tags.
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db, blogCategories, blogPosts, piercerProfile } from "@/db";

import { MarkdownRenderer } from "./MarkdownRenderer";
import { PostMeta } from "./PostMeta";
import styles from "./blog-post.module.css";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlogPostData {
    id: string;
    slug: string;
    title: string;
    excerpt: string | null;
    content: string;
    featuredImage: string | null;
    publishedAt: Date | null;
    readTimeMin: number | null;
    tags: string[] | null;
    category: { handle: string; name: string } | null;
    authorName: string | null;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getPostBySlug(slug: string): Promise<BlogPostData | null> {
    const [row] = await db
        .select({
            id: blogPosts.id,
            slug: blogPosts.slug,
            title: blogPosts.title,
            excerpt: blogPosts.excerpt,
            content: blogPosts.content,
            featuredImage: blogPosts.featuredImage,
            publishedAt: blogPosts.publishedAt,
            readTimeMin: blogPosts.readTimeMin,
            tags: blogPosts.tags,
            categoryHandle: blogCategories.handle,
            categoryName: blogCategories.name,
            authorFirstName: piercerProfile.firstName,
            authorLastName: piercerProfile.lastName,
        })
        .from(blogPosts)
        .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
        .leftJoin(piercerProfile, eq(piercerProfile.id, blogPosts.authorId))
        .where(
            and(
                eq(blogPosts.slug, slug),
                eq(blogPosts.status, "published"),
                isNotNull(blogPosts.publishedAt)
            )
        )
        .limit(1);

    if (!row) return null;

    // Build author display name
    let authorName: string | null = null;
    if (row.authorFirstName) {
        authorName = row.authorLastName
            ? `${row.authorFirstName} ${row.authorLastName}`
            : row.authorFirstName;
    }

    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        excerpt: row.excerpt,
        content: row.content,
        featuredImage: row.featuredImage,
        publishedAt: row.publishedAt,
        readTimeMin: row.readTimeMin,
        tags: row.tags,
        category:
            row.categoryHandle && row.categoryName
                ? { handle: row.categoryHandle, name: row.categoryName }
                : null,
        authorName,
    };
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

interface PageProps {
    params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { slug } = await params;
    const post = await getPostBySlug(slug);

    if (!post) {
        return { title: "Статья не найдена — PiercerKZN" };
    }

    const title = `${post.title} — PiercerKZN`;
    const description = post.excerpt || `${post.title} — блог PiercerKZN`;
    const imageUrl = post.featuredImage || undefined;

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            url: `https://piercerkzn.ru/blog/${post.slug}`,
            type: "article",
            ...(imageUrl && { images: [{ url: imageUrl }] }),
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            ...(imageUrl && { images: [imageUrl] }),
        },
    };
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default async function BlogPostPage({ params }: PageProps) {
    const { slug } = await params;
    const post = await getPostBySlug(slug);

    if (!post) {
        notFound();
    }

    // Fire-and-forget view count increment (Requirement 15.3)
    void db
        .update(blogPosts)
        .set({ viewCount: sql`coalesce(${blogPosts.viewCount}, 0) + 1` })
        .where(eq(blogPosts.id, post.id))
        .catch((err) => console.error("[blog/[slug]] viewCount bump failed", err));

    return (
        <article className={styles.postPage}>
            {/* Featured image with vignette overlay */}
            {post.featuredImage ? (
                <div className={styles.heroImageWrapper}>
                    <img src={post.featuredImage} alt="" className={styles.heroImage} />
                </div>
            ) : (
                <div className={styles.heroPlaceholder} aria-hidden="true">
                    BLOG
                </div>
            )}

            {/* Title */}
            <h1 className={styles.postTitle}>{post.title}</h1>

            {/* Meta: author, date, read time, category, tags */}
            <PostMeta
                authorName={post.authorName}
                publishedAt={post.publishedAt}
                readTimeMin={post.readTimeMin}
                category={post.category}
                tags={post.tags}
            />

            {/* Content */}
            <MarkdownRenderer content={post.content} />
        </article>
    );
}
