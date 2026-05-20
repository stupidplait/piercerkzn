"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useTransition } from "react";
import { useQueryStates } from "nuqs";

import type { CatalogFilterValues, Facets } from "./CatalogFilters";
import { CatalogFilters, catalogParsers } from "./CatalogFilters";
import styles from "./catalog.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProductCardData {
    id: string;
    handle: string;
    title: string;
    thumbnailUrl: string | null;
    material: string;
    jewelryType: string;
    has3dModel: boolean;
    minPrice: number | null;
    inStock: boolean;
}

interface CatalogGridProps {
    initialProducts: ProductCardData[];
    initialTotal: number;
    initialFacets: Facets;
    initialLimit: number;
    initialOffset: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MATERIAL_LABELS: Record<string, string> = {
    titanium: "Титан",
    gold_14k: "Золото 14K",
    gold_18k: "Золото 18K",
    gold_white_14k: "Белое золото 14K",
    gold_rose_14k: "Розовое золото 14K",
    steel: "Сталь",
    niobium: "Ниобий",
    bioplast: "Биопласт",
};

function formatPrice(kopecks: number): string {
    const rub = Math.floor(kopecks);
    return new Intl.NumberFormat("ru-RU").format(rub) + " ₽";
}

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CatalogGrid({
    initialProducts,
    initialTotal,
    initialFacets,
    initialLimit,
    initialOffset,
}: CatalogGridProps) {
    const [products, setProducts] = useState<ProductCardData[]>(initialProducts);
    const [total, setTotal] = useState(initialTotal);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    // Track current filters for retry
    const currentFiltersRef = useRef<CatalogFilterValues | null>(null);
    const isInitialMount = useRef(true);

    // Compute pagination
    const currentPage =
        currentFiltersRef.current?.page ?? Math.floor(initialOffset / initialLimit) + 1;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const fetchProducts = useCallback(async (filters: CatalogFilterValues) => {
        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams();
            if (filters.material) params.set("material", filters.material);
            if (filters.type) params.set("type", filters.type);
            if (filters.area) params.set("area", filters.area);
            if (filters.minPrice != null) params.set("minPrice", String(filters.minPrice));
            if (filters.maxPrice != null) params.set("maxPrice", String(filters.maxPrice));
            if (filters.search) params.set("search", filters.search);
            if (filters.sort) params.set("sort", filters.sort);
            params.set("limit", String(PAGE_SIZE));
            params.set("offset", String((filters.page - 1) * PAGE_SIZE));

            const res = await fetch(`/api/products?${params.toString()}`);
            if (!res.ok) {
                throw new Error(`Ошибка загрузки: ${res.status}`);
            }

            const data = await res.json();
            startTransition(() => {
                setProducts(data.products ?? []);
                setTotal(data.total ?? 0);
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Не удалось загрузить каталог");
        } finally {
            setLoading(false);
        }
    }, []);

    const handleFiltersChange = useCallback(
        (filters: CatalogFilterValues) => {
            currentFiltersRef.current = filters;

            // Skip fetch on initial mount — we already have server-rendered data
            if (isInitialMount.current) {
                isInitialMount.current = false;
                return;
            }

            fetchProducts(filters);
        },
        [fetchProducts]
    );

    const handleRetry = useCallback(() => {
        if (currentFiltersRef.current) {
            fetchProducts(currentFiltersRef.current);
        }
    }, [fetchProducts]);

    return (
        <div className={styles.gridContainer}>
            <CatalogFilters facets={initialFacets} onFiltersChange={handleFiltersChange} />

            {/* Loading state */}
            {(loading || isPending) && (
                <div className={styles.loadingOverlay} role="status" aria-live="polite">
                    Загрузка…
                </div>
            )}

            {/* Error state */}
            {error && !loading && (
                <div className={styles.errorState} role="alert">
                    <p className={styles.errorText}>{error}</p>
                    <button className={styles.retryBtn} onClick={handleRetry} type="button">
                        Попробовать снова
                    </button>
                </div>
            )}

            {/* Empty state */}
            {!loading && !error && products.length === 0 && (
                <div className={styles.emptyState}>
                    <h2 className={styles.emptyStateTitle}>Ничего не найдено</h2>
                    <p className={styles.emptyStateText}>
                        Попробуйте изменить фильтры или очистить поиск
                    </p>
                </div>
            )}

            {/* Product grid */}
            {!loading && !error && products.length > 0 && (
                <>
                    <div className={styles.productGrid}>
                        {products.map((product) => (
                            <article key={product.id} className={styles.productCard}>
                                <Link
                                    href={`/catalog/${product.handle}`}
                                    className={styles.cardLink}
                                >
                                    {product.thumbnailUrl ? (
                                        <img
                                            src={product.thumbnailUrl}
                                            alt={product.title}
                                            className={styles.cardThumbnail}
                                            loading="lazy"
                                        />
                                    ) : (
                                        <div className={styles.cardThumbnailPlaceholder}>
                                            Нет фото
                                        </div>
                                    )}
                                    <div className={styles.cardBody}>
                                        <h3 className={styles.cardTitle}>{product.title}</h3>
                                        <span className={styles.cardMaterial}>
                                            {MATERIAL_LABELS[product.material] ?? product.material}
                                        </span>
                                        <div className={styles.cardFooter}>
                                            <span className={styles.cardPrice}>
                                                {product.minPrice != null
                                                    ? formatPrice(product.minPrice)
                                                    : "—"}
                                            </span>
                                            <span
                                                className={styles.stockBadge}
                                                data-in-stock={product.inStock ? "1" : "0"}
                                            >
                                                {product.inStock ? "В наличии" : "Под заказ"}
                                            </span>
                                        </div>
                                    </div>
                                </Link>
                            </article>
                        ))}
                    </div>

                    {/* Pagination */}
                    <Pagination currentPage={currentPage} totalPages={totalPages} total={total} />
                </>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Pagination sub-component
// ---------------------------------------------------------------------------

interface PaginationProps {
    currentPage: number;
    totalPages: number;
    total: number;
}

function Pagination({ currentPage, totalPages, total }: PaginationProps) {
    const [, setParams] = useQueryStates(catalogParsers, { shallow: false });

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
        <nav className={styles.pagination} aria-label="Навигация по страницам">
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
                {currentPage} / {totalPages} · {total} шт.
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
