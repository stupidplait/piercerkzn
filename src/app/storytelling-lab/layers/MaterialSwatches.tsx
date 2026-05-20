"use client";

import styles from "./layers.module.css";
import type { LayerProps } from "./types";

/**
 * 04 — Material swatches.
 *
 * 3 small disc swatches (steel / titanium / rose gold) with the active
 * piece's material highlighted. Implies "we work in real materials"
 * even if today there's only one variant per piece.
 */
const SWATCHES = [
    { id: "steel", label: "Сталь", tint: "linear-gradient(135deg, #d6d6d6, #f8f8f8 50%, #aaa)" },
    {
        id: "titanium",
        label: "Титан",
        tint: "linear-gradient(135deg, #c8c4ba, #ecead8 50%, #9b988e)",
    },
    {
        id: "rose",
        label: "Розовое",
        tint: "linear-gradient(135deg, #d4a994, #f3d4c1 50%, #b18874)",
    },
];

function pickActiveSwatch(material: string) {
    const m = material.toLowerCase();
    if (m.includes("сталь")) return "steel";
    if (m.includes("титан")) return "titanium";
    return "steel";
}

export default function MaterialSwatches({ activeJewelry, items }: LayerProps) {
    const active = pickActiveSwatch(items[activeJewelry].material);
    return (
        <div className={styles.swatches} aria-hidden="true">
            <span className={styles.swatchesKicker}>материал</span>
            <div className={styles.swatchesRow}>
                {SWATCHES.map((s) => (
                    <button
                        key={s.id}
                        type="button"
                        className={styles.swatch}
                        data-active={s.id === active ? "true" : "false"}
                        aria-label={s.label}
                    >
                        <span className={styles.swatchDisc} style={{ background: s.tint }} />
                        <span className={styles.swatchLabel}>{s.label}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}
