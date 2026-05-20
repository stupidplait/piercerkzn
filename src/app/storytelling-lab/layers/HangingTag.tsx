"use client";

import styles from "./layers.module.css";
import type { LayerProps } from "./types";

/**
 * 05 — Hanging museum tag.
 *
 * Paper tag suspended on a thin string, hanging just below the floating
 * piece. Shows piece name + spec — a "museum label" affordance.
 */
export default function HangingTag({ activeJewelry, items }: LayerProps) {
    const current = items[activeJewelry];
    return (
        <div className={styles.tag} aria-hidden="true" key={current.id}>
            <span className={styles.tagString} />
            <span className={styles.tagPunch} />
            <div className={styles.tagBody}>
                <span className={styles.tagIndex}>
                    {String(activeJewelry + 1).padStart(2, "0")}
                </span>
                <span className={styles.tagName}>{current.name}</span>
                <span className={styles.tagMeta}>
                    {current.material.split(" ")[0]} · {current.gauge}
                </span>
            </div>
        </div>
    );
}
