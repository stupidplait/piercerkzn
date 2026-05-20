"use client";

import Link from "next/link";
import { useCallback, useRef, useState, useTransition } from "react";

import { AftercareFilter } from "./AftercareFilter";
import type { AftercareFilterValues } from "./AftercareFilter";
import styles from "./aftercare.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AftercareCardData {
    id: string;
    handle: string;
    title: string;
    piercingType: string;
    healingMinWeeks: number | null;
    healingMaxWeeks: number | null;
    iconUrl: string | null;
}

interface AftercareGridProps {
    initialGuides: AftercareCardData[];
    availableTypes: string[];
}

// ---------------------------------------------------------------------------
// Piercing type labels (Russian)
// ---------------------------------------------------------------------------

const PIERCING_TYPE_LABELS: Record<string, string> = {
    helix: "Хеликс",
    tragus: "Трагус",
    conch: "Конч",
    lobe: "Мочка",
    industrial: "Индастриал",
    rook: "Рук",
    daith: "Дейс",
    septum: "Септум",
    nostril: "Нострил",
    bridge: "Бридж",
    labret: "Лабрет",
    medusa: "Медуза",
    navel: "Пупок",
    tongue: "Язык",
    nipple: "Сосок",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatHealingRange(min: number | null, max: number | null): string | null {
    if (min == null && max == null) return null;
    if (min != null && max != null) return `${min}–${max} нед.`;
    if (min != null) return `от ${min} нед.`;
    return `до ${max} нед.`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AftercareGrid({ initialGuides, availableTypes }: AftercareGridProps) {
    const [guides, setGuides] = useState<AftercareCardData[]>(initialGuides);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isPending, startTransition] = useTransition();

    const currentFiltersRef = useRef<AftercareFilterValues | null>(null);
    const isInitialMount = useRef(true);

    const fetchGuides = useCallback(async (filters: AftercareFilterValues) => {
        setLoading(true);
        setError(null);

        try {
            const params = new URLSearchParams();
            if (filters.piercingType) params.set("piercingType", filters.piercingType);

            const res = await fetch(`/api/aftercare?${params.toString()}`);
            if (!res.ok) {
                throw new Error(`Ошибка загрузки: ${res.status}`);
            }

            const data = await res.json();
            startTransition(() => {
                setGuides(data.guides ?? []);
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Не удалось загрузить гайды по уходу");
        } finally {
            setLoading(false);
        }
    }, []);

    const handleFiltersChange = useCallback(
        (filters: AftercareFilterValues) => {
            currentFiltersRef.current = filters;

            // Skip fetch on initial mount — we already have server-rendered data
            if (isInitialMount.current) {
                isInitialMount.current = false;
                return;
            }

            fetchGuides(filters);
        },
        [fetchGuides]
    );

    const handleRetry = useCallback(() => {
        if (currentFiltersRef.current) {
            fetchGuides(currentFiltersRef.current);
        }
    }, [fetchGuides]);

    return (
        <div className={styles.gridContainer}>
            <AftercareFilter
                onFiltersChange={handleFiltersChange}
                availableTypes={availableTypes}
            />

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
            {!loading && !error && guides.length === 0 && (
                <div className={styles.emptyState}>
                    <h2 className={styles.emptyStateTitle}>Гайды не найдены</h2>
                    <p className={styles.emptyStateText}>
                        Попробуйте убрать фильтр по типу прокола
                    </p>
                </div>
            )}

            {/* Aftercare grid */}
            {!loading && !error && guides.length > 0 && (
                <div className={styles.aftercareGrid}>
                    {guides.map((guide) => (
                        <AftercareCard key={guide.id} guide={guide} />
                    ))}
                </div>
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// AftercareCard sub-component
// ---------------------------------------------------------------------------

function AftercareCard({ guide }: { guide: AftercareCardData }) {
    const healingRange = formatHealingRange(guide.healingMinWeeks, guide.healingMaxWeeks);
    const typeLabel = PIERCING_TYPE_LABELS[guide.piercingType] ?? guide.piercingType;

    return (
        <article className={styles.aftercareCard}>
            <Link href={`/aftercare/${guide.handle}`} className={styles.cardLink}>
                <div className={styles.cardIconRow}>
                    {guide.iconUrl ? (
                        <img
                            src={guide.iconUrl}
                            alt=""
                            className={styles.cardIcon}
                            loading="lazy"
                            aria-hidden="true"
                        />
                    ) : (
                        <span className={styles.cardIconPlaceholder} aria-hidden="true">
                            💎
                        </span>
                    )}
                    <h3 className={styles.cardTitle}>{guide.title}</h3>
                </div>
                <div className={styles.cardMeta}>
                    <span className={styles.cardPiercingType}>{typeLabel}</span>
                    {healingRange && <span className={styles.cardHealing}>{healingRange}</span>}
                </div>
            </Link>
        </article>
    );
}
