"use client";

import { useCallback, useEffect } from "react";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";

import styles from "./blog.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BlogSortOption = "newest" | "oldest" | "popular";

export interface BlogFilterValues {
    category: string | null;
    tag: string | null;
    sort: BlogSortOption;
    page: number;
}

export interface BlogCategory {
    id: string;
    handle: string;
    name: string;
}

// ---------------------------------------------------------------------------
// nuqs parsers
// ---------------------------------------------------------------------------

const SORT_OPTIONS = ["newest", "oldest", "popular"] as const;

export const blogParsers = {
    category: parseAsString,
    tag: parseAsString,
    sort: parseAsStringLiteral(SORT_OPTIONS).withDefault("newest"),
    page: parseAsInteger.withDefault(1),
};

// ---------------------------------------------------------------------------
// Sort labels (Russian)
// ---------------------------------------------------------------------------

const SORT_LABELS: Record<BlogSortOption, string> = {
    newest: "Новые",
    oldest: "Старые",
    popular: "Популярные",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BlogFiltersProps {
    categories: BlogCategory[];
    allTags: string[];
    onFiltersChange: (filters: BlogFilterValues) => void;
}

export function BlogFilters({ categories, allTags, onFiltersChange }: BlogFiltersProps) {
    const [params, setParams] = useQueryStates(blogParsers, {
        shallow: false,
    });

    // Notify parent on param changes
    useEffect(() => {
        onFiltersChange({
            category: params.category,
            tag: params.tag,
            sort: params.sort as BlogSortOption,
            page: params.page,
        });
    }, [params, onFiltersChange]);

    const handleCategoryClick = useCallback(
        (handle: string | null) => {
            setParams({ category: handle, page: 1 });
        },
        [setParams]
    );

    const handleTagClick = useCallback(
        (tag: string | null) => {
            setParams({ tag: tag === params.tag ? null : tag, page: 1 });
        },
        [setParams, params.tag]
    );

    const handleSortChange = useCallback(
        (value: string) => {
            setParams({ sort: (value as BlogSortOption) || "newest", page: 1 });
        },
        [setParams]
    );

    return (
        <div className={styles.filtersPanel}>
            {/* Category tabs row */}
            <div className={styles.filtersRow}>
                <span className={styles.filterLabel}>Категория:</span>
                <div
                    className={styles.categoryTabs}
                    role="tablist"
                    aria-label="Фильтр по категории"
                >
                    <button
                        role="tab"
                        type="button"
                        aria-selected={params.category === null}
                        className={
                            params.category === null ? styles.categoryTabActive : styles.categoryTab
                        }
                        onClick={() => handleCategoryClick(null)}
                    >
                        Все
                    </button>
                    {categories.map((cat) => (
                        <button
                            key={cat.id}
                            role="tab"
                            type="button"
                            aria-selected={params.category === cat.handle}
                            className={
                                params.category === cat.handle
                                    ? styles.categoryTabActive
                                    : styles.categoryTab
                            }
                            onClick={() => handleCategoryClick(cat.handle)}
                        >
                            {cat.name}
                        </button>
                    ))}
                </div>

                <div className={styles.sortGroup}>
                    <span className={styles.filterLabel}>Сортировка:</span>
                    <select
                        className={styles.sortSelect}
                        value={params.sort}
                        onChange={(e) => handleSortChange(e.target.value)}
                        aria-label="Сортировка статей"
                    >
                        {SORT_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                                {SORT_LABELS[opt]}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Tag chips row */}
            {allTags.length > 0 && (
                <div className={styles.filtersRow}>
                    <span className={styles.filterLabel}>Теги:</span>
                    <div className={styles.tagChips}>
                        {allTags.map((tag) => (
                            <button
                                key={tag}
                                type="button"
                                className={
                                    params.tag === tag ? styles.tagChipActive : styles.tagChip
                                }
                                onClick={() => handleTagClick(tag)}
                                aria-pressed={params.tag === tag}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
