"use client";

import styles from "../page.module.css";

/**
 * ScanLine — horizontal light sweep that fires once on entry.
 * Pure CSS animation, no JS state needed.
 */
export default function ScanLine({
    active = false,
    delay = 0,
}: {
    active?: boolean;
    delay?: number;
}) {
    return (
        <div
            className={styles.scanLine}
            data-active={active ? "1" : "0"}
            style={{ animationDelay: `${delay}ms` }}
        />
    );
}
