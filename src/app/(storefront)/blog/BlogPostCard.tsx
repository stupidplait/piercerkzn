import Link from "next/link";

import styles from "./blog.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BlogPostCardData {
    slug: string;
    title: string;
    excerpt: string | null;
    featuredImage: string | null;
    readTimeMin: number | null;
    publishedAt: Date | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
    return date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/Moscow",
    });
}

function truncateExcerpt(text: string | null, maxLength: number): string {
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength).trimEnd() + "…";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BlogPostCardProps {
    post: BlogPostCardData;
}

export function BlogPostCard({ post }: BlogPostCardProps) {
    const excerpt = truncateExcerpt(post.excerpt, 200);

    return (
        <article className={styles.postCard}>
            <Link href={`/blog/${post.slug}`} className={styles.cardLink}>
                {post.featuredImage ? (
                    <img
                        src={post.featuredImage}
                        alt=""
                        className={styles.cardImage}
                        loading="lazy"
                    />
                ) : (
                    <div className={styles.cardImagePlaceholder} aria-hidden="true">
                        BLOG
                    </div>
                )}

                <div className={styles.cardBody}>
                    <h2 className={styles.cardTitle}>{post.title}</h2>
                    {excerpt && <p className={styles.cardExcerpt}>{excerpt}</p>}

                    <div className={styles.cardMeta}>
                        {post.publishedAt && (
                            <time
                                className={styles.cardDate}
                                dateTime={post.publishedAt.toISOString()}
                            >
                                {formatDate(post.publishedAt)}
                            </time>
                        )}
                        {post.readTimeMin != null && (
                            <span className={styles.cardReadTime}>{post.readTimeMin} мин</span>
                        )}
                    </div>
                </div>
            </Link>
        </article>
    );
}
