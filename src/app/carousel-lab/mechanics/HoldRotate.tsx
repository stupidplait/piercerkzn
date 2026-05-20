"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./mechanics.module.css";
import type { MechanicProps } from "./types";

/**
 * 08 — Удержание / Hold-to-Rotate (interaction prototype).
 *
 * Press-and-hold anywhere on the stage = "freely rotate" the piece via
 * mouse drag. Visual feedback: a ring crosshair appears, two arc lines
 * trace the drag delta. Release settles. Arrows or click ‹›  to step
 * pieces (rotate is rotation only, not piece change — keeps the two
 * gestures separate).
 *
 * NOTE: The actual 3D rotation here drives a CSS marker overlay only —
 * deciding to ship this mechanic would require wiring `userRotation`
 * back into WireframeRoom's GlassPiece. The lab demonstrates the
 * INTERACTION FEEL; full 3D integration is a follow-up.
 */
export default function HoldRotate({
    activeJewelry,
    items,
    triggerSwap,
    chapterRef,
}: MechanicProps) {
    const [holding, setHolding] = useState(false);
    const [delta, setDelta] = useState({ dx: 0, dy: 0 });
    const startRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        const el = chapterRef.current;
        if (!el) return;

        const onPointerDown = (e: PointerEvent) => {
            // Skip if the user is pressing on a button (the step arrows)
            if ((e.target as HTMLElement)?.closest("button")) return;
            setHolding(true);
            startRef.current = { x: e.clientX, y: e.clientY };
            setDelta({ dx: 0, dy: 0 });
            el.setPointerCapture?.(e.pointerId);
        };
        const onPointerMove = (e: PointerEvent) => {
            if (!holding) return;
            setDelta({
                dx: e.clientX - startRef.current.x,
                dy: e.clientY - startRef.current.y,
            });
        };
        const onPointerUp = () => {
            if (!holding) return;
            setHolding(false);
            // Settle back to neutral
            setDelta({ dx: 0, dy: 0 });
        };

        el.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        return () => {
            el.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };
    }, [chapterRef, holding]);

    const total = items.length;
    const prevIdx = (activeJewelry - 1 + total) % total;
    const nextIdx = (activeJewelry + 1) % total;

    return (
        <div className={styles.holdRoot}>
            {/* Drag-feedback ring crosshair, centered, scales with hold */}
            <div
                className={styles.holdCrosshair}
                data-holding={holding ? "true" : "false"}
                style={{
                    transform: `translate(-50%, -50%) translate(${(delta.dx * 0.15).toFixed(1)}px, ${(delta.dy * 0.15).toFixed(1)}px)`,
                }}
                aria-hidden="true"
            >
                <span className={styles.holdCrosshairRing} />
                <span className={styles.holdCrosshairTickH} />
                <span className={styles.holdCrosshairTickV} />
            </div>

            {/* Arc trail showing rotation delta */}
            {holding && (
                <div
                    className={styles.holdArc}
                    style={{
                        transform: `translate(-50%, -50%) rotate(${(delta.dx * 0.6).toFixed(1)}deg)`,
                    }}
                    aria-hidden="true"
                />
            )}

            {/* Step arrows for piece change */}
            <div className={styles.holdSteps}>
                <button
                    type="button"
                    className={styles.holdStepBtn}
                    onClick={() => triggerSwap(-1)}
                    aria-label={`Предыдущее: ${items[prevIdx].name}`}
                >
                    ‹
                </button>
                <span className={styles.holdStepIndex}>
                    {String(activeJewelry + 1).padStart(2, "0")} / {String(total).padStart(2, "0")}
                </span>
                <button
                    type="button"
                    className={styles.holdStepBtn}
                    onClick={() => triggerSwap(1)}
                    aria-label={`Следующее: ${items[nextIdx].name}`}
                >
                    ›
                </button>
            </div>

            <p className={styles.holdHint}>
                <span className={styles.hintMark}>⊕</span>
                Зажми и крути — рассмотри украшение · стрелки — следующее
            </p>
        </div>
    );
}
