"use client";

import { useCallback, useEffect } from "react";
import { parseAsString, useQueryStates } from "nuqs";

import styles from "./aftercare.module.css";

// ---------------------------------------------------------------------------
// Piercing type options (Russian labels)
// ---------------------------------------------------------------------------

const PIERCING_TYPES = [
    { value: "helix", label: "Хеликс" },
    { value: "tragus", label: "Трагус" },
    { value: "conch", label: "Конч" },
    { value: "lobe", label: "Мочка" },
    { value: "industrial", label: "Индастриал" },
    { value: "rook", label: "Рук" },
    { value: "daith", label: "Дейс" },
    { value: "septum", label: "Септум" },
    { value: "nostril", label: "Нострил" },
    { value: "bridge", label: "Бридж" },
    { value: "labret", label: "Лабрет" },
    { value: "medusa", label: "Медуза" },
    { value: "navel", label: "Пупок" },
    { value: "tongue", label: "Язык" },
    { value: "nipple", label: "Сосок" },
] as const;

// ---------------------------------------------------------------------------
// nuqs parsers (exported for use in AftercareGrid)
// ---------------------------------------------------------------------------

export const aftercareParsers = {
    piercingType: parseAsString,
};

export interface AftercareFilterValues {
    piercingType: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface AftercareFilterProps {
    onFiltersChange: (filters: AftercareFilterValues) => void;
    /** Available piercing types from the data (to show only relevant tabs) */
    availableTypes?: string[];
}

export function AftercareFilter({ onFiltersChange, availableTypes }: AftercareFilterProps) {
    const [params, setParams] = useQueryStates(aftercareParsers, {
        shallow: false,
    });

    // Notify parent on param changes
    useEffect(() => {
        onFiltersChange({
            piercingType: params.piercingType,
        });
    }, [params, onFiltersChange]);

    const handleTabClick = useCallback(
        (type: string | null) => {
            setParams({ piercingType: type });
        },
        [setParams]
    );

    // Show only types that exist in the data, or all if not provided
    const displayTypes = availableTypes
        ? PIERCING_TYPES.filter((t) => availableTypes.includes(t.value))
        : PIERCING_TYPES;

    return (
        <div className={styles.filterPanel} role="tablist" aria-label="Фильтр по типу прокола">
            <span className={styles.filterLabel}>Тип:</span>

            <button
                role="tab"
                aria-selected={params.piercingType === null}
                className={params.piercingType === null ? styles.filterTabActive : styles.filterTab}
                onClick={() => handleTabClick(null)}
                type="button"
            >
                Все
            </button>

            {displayTypes.map((pt) => (
                <button
                    key={pt.value}
                    role="tab"
                    aria-selected={params.piercingType === pt.value}
                    className={
                        params.piercingType === pt.value ? styles.filterTabActive : styles.filterTab
                    }
                    onClick={() => handleTabClick(pt.value)}
                    type="button"
                >
                    {pt.label}
                </button>
            ))}
        </div>
    );
}
