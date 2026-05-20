"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";

import styles from "./catalog.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Facets {
    materials: Array<{ value: string; count: number }>;
    jewelryTypes: Array<{ value: string; count: number }>;
    piercingAreas: Array<{ value: string; count: number }>;
    priceBounds: { minRub: number | null; maxRub: number | null };
    totalProducts: number;
}

type SortOption = "newest" | "price_asc" | "price_desc" | "relevance";

export interface CatalogFilterValues {
    material: string | null;
    type: string | null;
    area: string | null;
    minPrice: number | null;
    maxPrice: number | null;
    search: string | null;
    sort: SortOption;
    page: number;
}

// ---------------------------------------------------------------------------
// Label maps (Russian)
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

const TYPE_LABELS: Record<string, string> = {
    stud: "Лабрет",
    hoop: "Кольцо",
    barbell: "Штанга",
    labret: "Лабрет",
    captive: "Кэптив",
    bcr: "BCR",
    circular: "Циркуляр",
    plug: "Плаг",
    tunnel: "Тоннель",
};

const AREA_LABELS: Record<string, string> = {
    ear_helix: "Хеликс",
    ear_tragus: "Трагус",
    ear_conch: "Конч",
    ear_lobe: "Мочка",
    ear_industrial: "Индастриал",
    ear_rook: "Рук",
    ear_daith: "Дейс",
    nose_septum: "Септум",
    nose_nostril: "Нострил",
    nose_bridge: "Бридж",
    lip_labret: "Лабрет (губа)",
    lip_medusa: "Медуза",
    eyebrow: "Бровь",
    navel: "Пупок",
    tongue: "Язык",
    dermal: "Дермал",
    nipple: "Сосок",
};

const SORT_LABELS: Record<SortOption, string> = {
    newest: "Новинки",
    price_asc: "Цена ↑",
    price_desc: "Цена ↓",
    relevance: "Релевантность",
};

// ---------------------------------------------------------------------------
// nuqs parsers
// ---------------------------------------------------------------------------

const SORT_OPTIONS = ["newest", "price_asc", "price_desc", "relevance"] as const;

export const catalogParsers = {
    material: parseAsString,
    type: parseAsString,
    area: parseAsString,
    minPrice: parseAsInteger,
    maxPrice: parseAsInteger,
    search: parseAsString,
    sort: parseAsStringLiteral(SORT_OPTIONS).withDefault("newest"),
    page: parseAsInteger.withDefault(1),
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface CatalogFiltersProps {
    facets: Facets;
    onFiltersChange: (filters: CatalogFilterValues) => void;
}

export function CatalogFilters({ facets, onFiltersChange }: CatalogFiltersProps) {
    const [params, setParams] = useQueryStates(catalogParsers, {
        shallow: false,
    });

    // Local search state for debounce
    const [localSearch, setLocalSearch] = useState(params.search ?? "");
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Notify parent on param changes
    useEffect(() => {
        onFiltersChange({
            material: params.material,
            type: params.type,
            area: params.area,
            minPrice: params.minPrice,
            maxPrice: params.maxPrice,
            search: params.search,
            sort: params.sort as SortOption,
            page: params.page,
        });
    }, [params, onFiltersChange]);

    // Sync local search with URL state (e.g. on back/forward)
    useEffect(() => {
        setLocalSearch(params.search ?? "");
    }, [params.search]);

    const handleSearchChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const value = e.target.value.slice(0, 200);
            setLocalSearch(value);

            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }

            debounceRef.current = setTimeout(() => {
                setParams({
                    search: value || null,
                    page: 1,
                });
            }, 300);
        },
        [setParams]
    );

    const handleFilterChange = useCallback(
        (key: "material" | "type" | "area", value: string) => {
            setParams({
                [key]: value || null,
                page: 1,
            });
        },
        [setParams]
    );

    const handlePriceChange = useCallback(
        (key: "minPrice" | "maxPrice", value: string) => {
            const num = value ? parseInt(value, 10) : null;
            setParams({
                [key]: num && !isNaN(num) ? num : null,
                page: 1,
            });
        },
        [setParams]
    );

    const handleSortChange = useCallback(
        (value: string) => {
            setParams({
                sort: (value as SortOption) || "newest",
                page: 1,
            });
        },
        [setParams]
    );

    const hasSearch = Boolean(params.search);

    return (
        <div className={styles.filtersPanel}>
            {/* Search row */}
            <div className={styles.filtersRow}>
                <div className={styles.filterGroup} style={{ flex: 2 }}>
                    <label className={styles.filterLabel} htmlFor="catalog-search">
                        Поиск
                    </label>
                    <input
                        id="catalog-search"
                        type="search"
                        className={styles.searchInput}
                        placeholder="Найти украшение…"
                        value={localSearch}
                        onChange={handleSearchChange}
                        maxLength={200}
                        aria-label="Поиск по каталогу"
                    />
                </div>

                <div className={styles.filterGroup}>
                    <label className={styles.filterLabel} htmlFor="catalog-sort">
                        Сортировка
                    </label>
                    <select
                        id="catalog-sort"
                        className={styles.filterSelect}
                        value={params.sort}
                        onChange={(e) => handleSortChange(e.target.value)}
                        aria-label="Сортировка"
                    >
                        {SORT_OPTIONS.map((opt) => (
                            <option
                                key={opt}
                                value={opt}
                                disabled={opt === "relevance" && !hasSearch}
                            >
                                {SORT_LABELS[opt]}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Filter controls row */}
            <div className={styles.filtersRow}>
                <div className={styles.filterGroup}>
                    <label className={styles.filterLabel} htmlFor="catalog-material">
                        Материал
                    </label>
                    <select
                        id="catalog-material"
                        className={styles.filterSelect}
                        value={params.material ?? ""}
                        onChange={(e) => handleFilterChange("material", e.target.value)}
                        aria-label="Фильтр по материалу"
                    >
                        <option value="">Все</option>
                        {facets.materials.map((m) => (
                            <option key={m.value} value={m.value}>
                                {MATERIAL_LABELS[m.value] ?? m.value} ({m.count})
                            </option>
                        ))}
                    </select>
                </div>

                <div className={styles.filterGroup}>
                    <label className={styles.filterLabel} htmlFor="catalog-type">
                        Тип
                    </label>
                    <select
                        id="catalog-type"
                        className={styles.filterSelect}
                        value={params.type ?? ""}
                        onChange={(e) => handleFilterChange("type", e.target.value)}
                        aria-label="Фильтр по типу"
                    >
                        <option value="">Все</option>
                        {facets.jewelryTypes.map((t) => (
                            <option key={t.value} value={t.value}>
                                {TYPE_LABELS[t.value] ?? t.value} ({t.count})
                            </option>
                        ))}
                    </select>
                </div>

                <div className={styles.filterGroup}>
                    <label className={styles.filterLabel} htmlFor="catalog-area">
                        Зона
                    </label>
                    <select
                        id="catalog-area"
                        className={styles.filterSelect}
                        value={params.area ?? ""}
                        onChange={(e) => handleFilterChange("area", e.target.value)}
                        aria-label="Фильтр по зоне прокола"
                    >
                        <option value="">Все</option>
                        {facets.piercingAreas.map((a) => (
                            <option key={a.value} value={a.value}>
                                {AREA_LABELS[a.value] ?? a.value} ({a.count})
                            </option>
                        ))}
                    </select>
                </div>

                <div className={styles.filterGroup}>
                    <label className={styles.filterLabel}>Цена, ₽</label>
                    <div className={styles.priceRange}>
                        <input
                            type="number"
                            className={styles.priceInput}
                            placeholder={
                                facets.priceBounds.minRub != null
                                    ? String(facets.priceBounds.minRub)
                                    : "от"
                            }
                            value={params.minPrice ?? ""}
                            onChange={(e) => handlePriceChange("minPrice", e.target.value)}
                            min={0}
                            aria-label="Минимальная цена"
                        />
                        <span className={styles.priceSeparator}>—</span>
                        <input
                            type="number"
                            className={styles.priceInput}
                            placeholder={
                                facets.priceBounds.maxRub != null
                                    ? String(facets.priceBounds.maxRub)
                                    : "до"
                            }
                            value={params.maxPrice ?? ""}
                            onChange={(e) => handlePriceChange("maxPrice", e.target.value)}
                            min={0}
                            aria-label="Максимальная цена"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
