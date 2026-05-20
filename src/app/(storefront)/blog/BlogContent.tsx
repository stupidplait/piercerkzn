"use client";

import { useCallback, useRef } from "react";
import { useQueryStates } from "nuqs";

import { BlogFilters, blogParsers, type BlogCategory, type BlogFilterValues } from "./BlogFilters";
import { BlogPostCard, type BlogPostCardData } from "./BlogPostCard";
import styles from "./blog.module.css";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface BlogContentProps {
    categories: BlogCategory[];
    allTags: string[];
    initialPosts: BlogPostCardData[];
    initialTotal: number;
    initialTotalPages: number;
    initialPage: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlogContent({
    categories,
    allTags,
    initialPosts,
    initialTotal,
    initialTotalPages,
    initialPage,
}: BlogContentProps) {
    const isInitialMount = useRef(true);

    // With shallow: false, nuqs triggers a full server re-render on param change.
    // The server component re-fetches data and passes fresh props here.
    // We just need the filters to drive the URL state.
    const handleFiltersChange = useCallback((_filters: BlogFilterValues) => {
        if (isInitialMount.current) {
            isInitialMount.current = false;
            return;
        }
        // No client-side fetch needed — shallow: false causes server re-render
    }, []);

    return (
        <div>
            <BlogFilters
                categories={categories}
                allTags={allTags}
                onFiltersChange={handleFiltersChange}
            />

            {/* Empty state */}
            {initialPosts.length === 0 && (
                <div className={styles.emptyState}>
                    <h2 className={styles.emptyStateTitle}>Статей не найдено</h2>
                    <p className={styles.emptyStateText}>
                        Попробуйте сбросить фильтры или посмотреть все статьи
                    </p>
                </div>
            )}

            {/* Post grid */}
            {initialPosts.length > 0 && (
                <>
                    <div className={styles.postGrid}>
                        {initialPosts.map((post) => (
                            <BlogPostCard key={post.slug} post={post} />
                        ))}
                    </div>

                    {/* Pagination */}
                    {initialTotalPages > 1 && (
                        <BlogPagination
                            currentPage={initialPage}
                            totalPages={initialTotalPages}
                            total={initialTotal}
                        />
                    )}
                </>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Pagination sub-component
// ---------------------------------------------------------------------------

interface BlogPaginationProps {
    currentPage: number;
    totalPages: number;
    total: number;
}

function BlogPagination({ currentPage, totalPages, total }: BlogPaginationProps) {
    const [, setParams] = useQueryStates(blogParsers, { shallow: false });

    const handlePrev = () => {
        if (currentPage > 1) {
            setParams({ page: currentPage - 1 });
        }
    };

    const handleNext = () => {
        if (currentPage < totalPages) {
            setParams({ page: currentPage + 1 });
        }
    };

    return (
        <nav className={styles.pagination} aria-label="Навигация по страницам блога">
            <button
                className={styles.paginationBtn}
                onClick={handlePrev}
                disabled={currentPage <= 1}
                type="button"
                aria-label="Предыдущая страница"
            >
                ← Назад
            </button>
            <span className={styles.paginationInfo}>
                {currentPage} / {totalPages} · {total} статей
            </span>
            <button
                className={styles.paginationBtn}
                onClick={handleNext}
                disabled={currentPage >= totalPages}
                type="button"
                aria-label="Следующая страница"
            >
                Вперёд →
            </button>
        </nav>
    );
}
