"use client";

import styles from "./mechanics.module.css";
import type { MechanicProps } from "./types";

/**
 * 01 — Полоска / Tab Strip.
 *
 * Horizontal nav row of all 6 piece names. Active item is underlined in
 * accent pink with a sliding indicator. Most discoverable mechanic —
 * essentially "obvious nav for a catalog."
 */
export default function TabStrip({ activeJewelry, items, goToIndex }: MechanicProps) {
    return (
        <div className={styles.tabStripRoot}>
            <nav className={styles.tabStrip} aria-label="Выбор украшения">
                {items.map((item, i) => (
                    <button
                        key={item.id}
                        type="button"
                        className={styles.tabStripBtn}
                        data-active={i === activeJewelry ? "true" : "false"}
                        onClick={() => goToIndex(i)}
                    >
                        <span className={styles.tabStripBtnNum}>
                            {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className={styles.tabStripBtnName}>{item.name}</span>
                    </button>
                ))}
                <span
                    className={styles.tabStripIndicator}
                    style={{
                        transform: `translateX(${activeJewelry * 100}%)`,
                        width: `calc(100% / ${items.length})`,
                    }}
                />
            </nav>
        </div>
    );
}
