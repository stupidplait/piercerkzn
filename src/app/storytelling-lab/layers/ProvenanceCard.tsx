"use client";

import styles from "./layers.module.css";
import type { LayerProps } from "./types";

/**
 * 08 — Provenance / certification micro-card.
 *
 * Small "passport" tag in the lower-left showing batch + certification
 * standard for the active piece. Reinforces the medical-grade material
 * claim with a paper-trail vibe.
 */
function batchCode(idx: number) {
    return `KZN-${String(2026).padStart(4, "0")}-${String(idx + 17).padStart(3, "0")}`;
}

function certifyingStandard(material: string) {
    if (material.toLowerCase().includes("титан")) return "ASTM F136";
    return "ISO 5832-1";
}

export default function ProvenanceCard({ activeJewelry, items }: LayerProps) {
    const current = items[activeJewelry];
    return (
        <div className={styles.provenance} aria-hidden="true" key={current.id}>
            <div className={styles.provenanceRow}>
                <span className={styles.provenanceKey}>СТАНДАРТ</span>
                <span className={styles.provenanceVal}>{certifyingStandard(current.material)}</span>
            </div>
            <div className={styles.provenanceRow}>
                <span className={styles.provenanceKey}>ПАРТИЯ</span>
                <span className={styles.provenanceVal}>{batchCode(activeJewelry)}</span>
            </div>
            <div className={styles.provenanceRow}>
                <span className={styles.provenanceKey}>ПРОВЕРЕНО</span>
                <span className={styles.provenanceVal}>2026 · KZN</span>
            </div>
            <span className={styles.provenanceStamp}>VERIFIED</span>
        </div>
    );
}
