"use client";

import styles from "./mechanics.module.css";
import type { MechanicProps } from "./types";

/**
 * 02 — Плитки / Pressure Plates.
 *
 * 6 numbered tiles arranged in a horizontal arc near the bottom of the
 * viewport, like floor markers around a podium. Stepping on a plate =
 * teleporting that piece up to the centre. Active plate glows + lifts
 * slightly. CSS-only "arc" via individual translateY offsets.
 */
const ARC = [-12, -4, 0, 0, -4, -12]; // y-offset per plate (px), forms a shallow smile

export default function PressurePlates({ activeJewelry, items, goToIndex }: MechanicProps) {
    return (
        <div className={styles.platesRoot}>
            <div className={styles.platesArc}>
                {items.map((item, i) => (
                    <button
                        key={item.id}
                        type="button"
                        className={styles.plate}
                        data-active={i === activeJewelry ? "true" : "false"}
                        style={{ "--arc-y": `${ARC[i] ?? 0}px` } as React.CSSProperties}
                        onClick={() => goToIndex(i)}
                        aria-label={item.name}
                    >
                        <span className={styles.plateInner}>
                            <span className={styles.plateNum}>
                                {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className={styles.plateName}>{item.name}</span>
                            <span className={styles.platePulse} aria-hidden="true" />
                        </span>
                    </button>
                ))}
            </div>
        </div>
    );
}
