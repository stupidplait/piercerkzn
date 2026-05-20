"use client";

import { useEffect, useRef } from "react";
import styles from "./mechanics.module.css";
import type { MechanicProps } from "./types";

/**
 * 05 — Силуэты / Coverflow Silhouettes.
 *
 * Centre stays clear (the 3D piece floats there). Faded text-silhouettes
 * of the previous and next pieces sit on either side; tapping them
 * steers. Lightest-touch mechanic — keeps swipe primary, just makes its
 * existence visible.
 */
export default function Coverflow({
    activeJewelry,
    items,
    triggerSwap,
    chapterRef,
}: MechanicProps) {
    const total = items.length;
    const prevIdx = (activeJewelry - 1 + total) % total;
    const nextIdx = (activeJewelry + 1) % total;

    // Bind swipe to the chapterRef stage (full-viewport drag)
    const lastSwapTime = useRef(0);
    useEffect(() => {
        const el = chapterRef.current;
        if (!el) return;
        let startX = 0,
            startY = 0;
        let swiping = false;
        let directionLocked = false;
        let isHorizontal = false;
        const threshold = 100;

        const onPointerDown = (e: PointerEvent) => {
            swiping = true;
            directionLocked = false;
            isHorizontal = false;
            startX = e.clientX;
            startY = e.clientY;
        };
        const onPointerMove = (e: PointerEvent) => {
            if (!swiping) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!directionLocked && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
                directionLocked = true;
                isHorizontal = Math.abs(dx) > Math.abs(dy);
            }
            if (directionLocked && isHorizontal && Math.abs(dx) > threshold) {
                const now = Date.now();
                if (now - lastSwapTime.current >= 600) {
                    lastSwapTime.current = now;
                    triggerSwap(dx < 0 ? 1 : -1);
                }
                swiping = false;
            }
        };
        const onPointerUp = () => {
            swiping = false;
        };

        el.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        return () => {
            el.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };
    }, [chapterRef, triggerSwap]);

    return (
        <div className={styles.coverflowRoot}>
            <button
                type="button"
                className={styles.coverflowGhost}
                data-pos="prev"
                onClick={() => triggerSwap(-1)}
            >
                <span className={styles.coverflowGhostNum}>
                    {String(prevIdx + 1).padStart(2, "0")}
                </span>
                <span className={styles.coverflowGhostName}>{items[prevIdx].name}</span>
                <span className={styles.coverflowGhostArrow}>‹</span>
            </button>

            <button
                type="button"
                className={styles.coverflowGhost}
                data-pos="next"
                onClick={() => triggerSwap(1)}
            >
                <span className={styles.coverflowGhostArrow}>›</span>
                <span className={styles.coverflowGhostNum}>
                    {String(nextIdx + 1).padStart(2, "0")}
                </span>
                <span className={styles.coverflowGhostName}>{items[nextIdx].name}</span>
            </button>

            <p className={styles.coverflowHint}>
                <span className={styles.hintMark}>↔</span> Свайп · стрелки · клик по силуэту
            </p>
        </div>
    );
}
