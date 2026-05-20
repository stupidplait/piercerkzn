"use client";

import { useEffect, useState } from "react";
import styles from "./mechanics.module.css";
import type { MechanicProps } from "./types";

/**
 * 03 — Карусель / Turntable.
 *
 * 6 named pills arranged around a circle. The whole circle rotates so
 * the active piece sits at the front (12 o'clock). Click any pill to
 * spin to it — the rotation animates smoothly via CSS transform.
 *
 * Pure CSS-3D — no actual 3D models, just a layout affordance. The
 * jewelry on the podium below is the 3D piece; the pills steer.
 */
export default function Turntable({ activeJewelry, items, goToIndex }: MechanicProps) {
    const total = items.length;
    const stepDeg = 360 / total;
    // Rotate the wheel so the active item lands at top (0deg).
    const wheelRotation = -activeJewelry * stepDeg;

    // Optional gentle idle rotation hint — not enabled by default; the
    // spec called for pause-on-idle. Leaving as a soft visual breath.
    const [breath, setBreath] = useState(0);
    useEffect(() => {
        let raf = 0;
        const start = performance.now();
        const tick = () => {
            const elapsed = (performance.now() - start) / 1000;
            setBreath(Math.sin(elapsed * 0.8) * 1.5);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, []);

    return (
        <div className={styles.turntableRoot}>
            <div
                className={styles.turntableWheel}
                style={{
                    transform: `translate(-50%, 0) rotate(${(wheelRotation + breath).toFixed(2)}deg)`,
                }}
            >
                {items.map((item, i) => {
                    const angle = i * stepDeg;
                    return (
                        <button
                            key={item.id}
                            type="button"
                            className={styles.turntablePill}
                            data-active={i === activeJewelry ? "true" : "false"}
                            style={{
                                transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-180px) rotate(${(-angle - wheelRotation - breath).toFixed(2)}deg)`,
                            }}
                            onClick={() => goToIndex(i)}
                        >
                            <span className={styles.turntablePillNum}>
                                {String(i + 1).padStart(2, "0")}
                            </span>
                            <span className={styles.turntablePillName}>{item.name}</span>
                        </button>
                    );
                })}
                <span className={styles.turntablePivot} aria-hidden="true" />
                <span className={styles.turntableMarker} aria-hidden="true" />
            </div>
            <p className={styles.turntableHint}>
                <span className={styles.hintMark}>↻</span> Кликни лепесток — карусель повернётся к
                нему
            </p>
        </div>
    );
}
