"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useTransition } from "react";
import { useQueryStates } from "nuqs";

import { LooksFilter, looksParsers } from "./LooksFilter";
import type { LooksFilterValues } from "./LooksFilter";
import styles from "./looks.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LookCardData {
    id: string;
    handle: string;
    title: string;
    thumbnailUrl: string | null;
    bodyArea: string;
    bundlePrice: number;
    discountPercent: string | null;
    pieceCount: number;
}

interface LooksGridProps {
    initialLooks: LookCardData[];
    initialTotal: number;
    initialLimit: number;
    initialOffset: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(kopecks: number): string {
    const rub = Math.floor(kopecks);
    return new Intl.NumberFormat("ru-RU").format(rub) + " ₽";
}

function formatDiscount(percent: string | null): string | null {
    if (!percent) return null;
    const num = parseFloat(percent);
    if (isNaN(num) || num <= 0) return null;
    return `-${Math.round(num)}%`;
}

function pluralizePieces(count: number): string {
    if (count === 1) return "1 украшение";
    if (count >= 2 && count <= 4) return `${count} украшения`;
    return `${count} украшений`;
}

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LooksGrid({
    initialLooks,
    initialTotal,
    initialLimit,
    initialOffset,
}: LooksGridProps) {
    const [looks, setLooks] = useState<LookCardData[]>(initialLooks);
    const [total, setTotal] = useState(initialTotal);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const currentFiltersRef = useRef<LooksFilterValues | null>(null);
    const isInitialMount = useRef(true);

    // Compute pagination
    const currentPage =
        currentFiltersRef.current?.page ?? Math.floor(initialOffset / initialLimit) + 1;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

    const fetchLooks = useCallback(async (filters: LooksFilterValues) => {
        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams();
            if (filters.bodyArea) params.set("bodyArea", filters.bodyArea);
            params.set("limit", String(PAGE_SIZE));
            params.set("offset", String((filters.page - 1) * PAGE_SIZE));

            const res = await fetch(`/api/looks?${params.toString()}`);
            if (!res.ok) {
                throw new Error(`Ошибка загрузки: ${res.status}`);
            }

            const data = await res.json();
            startTransition(() => {
                setLooks(data.looks ?? []);
                setTotal(data.total ?? 0);
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Не удалось загрузить образы");
        } finally {
            setLoading(false);
        }
    }, []);

    const handleFiltersChange = useCallback(
        (filters: LooksFilterValues) => {
            currentFiltersRef.current = filters;

            // Skip fetch on initial mount — we already have server-rendered data
            if (isInitialMount.current) {
                isInitialMount.current = false;
                return;
            }

            fetchLooks(filters);
        },
        [fetchLooks]
    );

    const handleRetry = useCallback(() => {
        if (currentFiltersRef.current) {
            fetchLooks(currentFiltersRef.current);
        }
    }, [fetchLooks]);

    return (
        <div className={styles.gridContainer}>
            <LooksFilter onFiltersChange={handleFiltersChange} />

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
            {!loading && !error && looks.length === 0 && (
                <div className={styles.emptyState}>
                    <h2 className={styles.emptyStateTitle}>Образы не найдены</h2>
                    <p className={styles.emptyStateText}>Попробуйте убрать фильтр по зоне тела</p>
                </div>
            )}

            {/* Looks grid */}
            {!loading && !error && looks.length > 0 && (
                <>
                    <div className={styles.looksGrid}>
                        {looks.map((look) => (
                            <LookCard key={look.id} look={look} />
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
// LookCard sub-component
// ---------------------------------------------------------------------------

function LookCard({ look }: { look: LookCardData }) {
    const discount = formatDiscount(look.discountPercent);

    return (
        <article className={styles.lookCard}>
            <Link href={`/looks/${look.handle}`} className={styles.cardLink}>
                {look.thumbnailUrl ? (
                    <img
                        src={look.thumbnailUrl}
                        alt={look.title}
                        className={styles.cardThumbnail}
                        loading="lazy"
                    />
                ) : (
                    <div className={styles.cardThumbnailPlaceholder}>Нет фото</div>
                )}
                <div className={styles.cardBody}>
                    <h3 className={styles.cardTitle}>{look.title}</h3>
                    <div className={styles.cardMeta}>
                        <span className={styles.cardPieceCount}>
                            {pluralizePieces(look.pieceCount)}
                        </span>
                    </div>
                    <div className={styles.cardFooter}>
                        <span className={styles.cardPrice}>{formatPrice(look.bundlePrice)}</span>
                        {discount && <span className={styles.discountBadge}>{discount}</span>}
                    </div>
                </div>
            </Link>
        </article>
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
    const [, setParams] = useQueryStates(looksParsers, { shallow: false });

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
