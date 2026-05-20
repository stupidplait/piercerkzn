"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./mechanics.module.css";
import type { MechanicProps } from "./types";

/**
 * 07 — Фильтр / Material Filter Chips.
 *
 * Top filter bar groups pieces by material family (Все · Сталь · Титан).
 * Below, a horizontal scroller of the filtered subset, each item a
 * compact card. Picks within the subset; if the user picks "Сталь"
 * while a Titanium piece is active, the active doesn't change (we
 * don't auto-jump), but the inactive items dim.
 *
 * Scaffolds material storytelling without adding new SKUs.
 */

const FILTERS = [
    { id: "all", label: "Все", match: () => true },
    { id: "steel", label: "Сталь", match: (m: string) => m.toLowerCase().includes("сталь") },
    { id: "titanium", label: "Титан", match: (m: string) => m.toLowerCase().includes("титан") },
] as const;

export default function FilterChips({ activeJewelry, items, goToIndex }: MechanicProps) {
    const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");

    const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];

    // Indexes of items that match the filter (for dimming non-matches)
    const matches = useMemo(() => {
        const set = new Set<number>();
        items.forEach((item, i) => {
            if (active.match(item.material)) set.add(i);
        });
        return set;
    }, [items, active]);

    // When filter changes, if the active piece doesn't match, walk to
    // the nearest matching piece in the filtered subset.
    useEffect(() => {
        if (matches.has(activeJewelry)) return;
        // Find nearest match by ring distance
        const total = items.length;
        let best = activeJewelry;
        let bestDist = Infinity;
        matches.forEach((i) => {
            const fwd = (i - activeJewelry + total) % total;
            const back = (activeJewelry - i + total) % total;
            const d = Math.min(fwd, back);
            if (d < bestDist) {
                bestDist = d;
                best = i;
            }
        });
        if (best !== activeJewelry) goToIndex(best);
    }, [filter]); // intentionally only on filter change

    return (
        <div className={styles.filterRoot}>
            <div className={styles.filterChips} role="tablist">
                {FILTERS.map((f) => (
                    <button
                        key={f.id}
                        type="button"
                        role="tab"
                        aria-selected={filter === f.id}
                        className={styles.filterChip}
                        data-active={filter === f.id ? "true" : "false"}
                        onClick={() => setFilter(f.id)}
                    >
                        {f.label}
                        <span className={styles.filterChipCount}>
                            {f.id === "all"
                                ? items.length
                                : items.filter((it) => f.match(it.material)).length}
                        </span>
                    </button>
                ))}
            </div>

            <div className={styles.filterRow}>
                {items.map((item, i) => (
                    <button
                        key={item.id}
                        type="button"
                        className={styles.filterCard}
                        data-active={i === activeJewelry ? "true" : "false"}
                        data-dim={matches.has(i) ? "false" : "true"}
                        onClick={() => goToIndex(i)}
                    >
                        <span className={styles.filterCardNum}>
                            {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className={styles.filterCardName}>{item.name}</span>
                        <span className={styles.filterCardMaterial}>
                            {item.material.split(" ")[0]}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}
