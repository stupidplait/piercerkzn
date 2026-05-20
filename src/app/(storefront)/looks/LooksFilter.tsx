"use client";

import { useCallback, useEffect } from "react";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";

import styles from "./looks.module.css";

// ---------------------------------------------------------------------------
// Body area options (Russian labels)
// ---------------------------------------------------------------------------

const BODY_AREAS = [
    { value: "ear", label: "Ухо" },
    { value: "nose", label: "Нос" },
    { value: "lip", label: "Губа" },
    { value: "navel", label: "Пупок" },
] as const;

// ---------------------------------------------------------------------------
// nuqs parsers (exported for use in LooksGrid)
// ---------------------------------------------------------------------------

export const looksParsers = {
    bodyArea: parseAsString,
    page: parseAsInteger.withDefault(1),
};

export interface LooksFilterValues {
    bodyArea: string | null;
    page: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface LooksFilterProps {
    onFiltersChange: (filters: LooksFilterValues) => void;
}

export function LooksFilter({ onFiltersChange }: LooksFilterProps) {
    const [params, setParams] = useQueryStates(looksParsers, {
        shallow: false,
    });

    // Notify parent on param changes (mirrors CatalogFilters pattern)
    useEffect(() => {
        onFiltersChange({
            bodyArea: params.bodyArea,
            page: params.page,
        });
    }, [params, onFiltersChange]);

    const handleTabClick = useCallback(
        (area: string | null) => {
            setParams({ bodyArea: area, page: 1 });
        },
        [setParams]
    );

    return (
        <div className={styles.filterPanel} role="tablist" aria-label="Фильтр по зоне тела">
            <span className={styles.filterLabel}>Зона:</span>

            <button
                role="tab"
                aria-selected={params.bodyArea === null}
                className={params.bodyArea === null ? styles.filterTabActive : styles.filterTab}
                onClick={() => handleTabClick(null)}
                type="button"
            >
                Все
            </button>

            {BODY_AREAS.map((area) => (
                <button
                    key={area.value}
                    role="tab"
                    aria-selected={params.bodyArea === area.value}
                    className={
                        params.bodyArea === area.value ? styles.filterTabActive : styles.filterTab
                    }
                    onClick={() => handleTabClick(area.value)}
                    type="button"
                >
                    {area.label}
                </button>
            ))}
        </div>
    );
}
