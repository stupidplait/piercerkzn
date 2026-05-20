/**
 * PostMeta — displays blog post metadata: author, date, read time, category, tags.
 * Category and tags render as clickable links to the blog index with filters applied.
 */

import Link from "next/link";

import styles from "./blog-post.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PostMetaProps {
    authorName: string | null;
    publishedAt: Date | null;
    readTimeMin: number | null;
    category: { handle: string; name: string } | null;
    tags: string[] | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(date: Date): string {
    return date.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Europe/Moscow",
    });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PostMeta({ authorName, publishedAt, readTimeMin, category, tags }: PostMetaProps) {
    const metaItems: React.ReactNode[] = [];

    if (authorName) {
        metaItems.push(
            <span key="author" className={styles.metaItem}>
                {authorName}
            </span>
        );
    }

    if (publishedAt) {
        metaItems.push(
            <time key="date" className={styles.metaItem} dateTime={publishedAt.toISOString()}>
                {formatDate(publishedAt)}
            </time>
        );
    }

    if (readTimeMin != null) {
        metaItems.push(
            <span key="readtime" className={styles.metaItem}>
                {readTimeMin} мин чтения
            </span>
        );
    }

    if (category) {
        metaItems.push(
            <Link
                key="category"
                href={`/blog?category=${category.handle}`}
                className={styles.metaLink}
            >
                {category.name}
            </Link>
        );
    }

    // Interleave separators
    const elements: React.ReactNode[] = [];
    metaItems.forEach((item, i) => {
        if (i > 0) {
            elements.push(
                <span key={`sep-${i}`} className={styles.metaSeparator} aria-hidden="true" />
            );
        }
        elements.push(item);
    });

    return (
        <>
            <div className={styles.postMeta}>{elements}</div>

            {tags && tags.length > 0 && (
                <div className={styles.tagsRow}>
                    {tags.map((tag) => (
                        <Link
                            key={tag}
                            href={`/blog?tag=${encodeURIComponent(tag)}`}
                            className={styles.tagLink}
                        >
                            #{tag}
                        </Link>
                    ))}
                </div>
            )}
        </>
    );
}
