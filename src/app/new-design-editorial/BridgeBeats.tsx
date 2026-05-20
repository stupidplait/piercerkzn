"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

/**
 * Editorial bridge between hero and Chapter 1.
 *
 * Two layered beats driven by scrollPhase (0→1):
 *   • Tagline relay — short RU line peaks around mid-scroll, fades through.
 *   • Chapter card — "ГЛАВА 01 / ВИЗУАЛИЗАТОР" rises from below as the
 *     wordmark dissolves, then pins as Chapter 1's persistent label.
 */
interface BridgeBeatsProps {
    scrollPhase: React.RefObject<number>;
}

export default function BridgeBeats({ scrollPhase }: BridgeBeatsProps) {
    const taglineRef = useRef<HTMLDivElement | null>(null);
    const cardRef = useRef<HTMLDivElement | null>(null);
    // Hidden until the user scrolls a tiny bit — avoids the beat showing
    // on initial page load before the wordmark even fades.
    const [armed, setArmed] = useState(false);

    useEffect(() => {
        let raf = 0;
        const tick = () => {
            const p = scrollPhase.current ?? 0;
            if (!armed && p > 0.02) setArmed(true);

            // Tagline: bell curve — invisible at p=0 and p=1, peaks ~0.45.
            // sin(πp) gives 0→1→0 over [0,1].
            const taglineOpacity = armed ? Math.max(0, Math.sin(Math.PI * p)) : 0;
            const taglineLift = (1 - taglineOpacity) * 12;

            if (taglineRef.current) {
                taglineRef.current.style.opacity = taglineOpacity.toFixed(3);
                taglineRef.current.style.transform = `translate3d(0, ${taglineLift.toFixed(2)}px, 0)`;
            }

            // Chapter card: fades + rises from below across p=0.4→1, then pins.
            const cardP = Math.max(0, Math.min(1, (p - 0.4) / 0.6));
            const cardOpacity = armed ? cardP : 0;
            const cardLift = (1 - cardP) * 24;

            if (cardRef.current) {
                cardRef.current.style.opacity = cardOpacity.toFixed(3);
                cardRef.current.style.transform = `translate3d(0, ${cardLift.toFixed(2)}px, 0)`;
            }

            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [armed, scrollPhase]);

    return (
        <div className={styles.bridgeBeats} aria-hidden="true">
            <div ref={taglineRef} className={styles.bridgeTagline}>
                <span className={styles.bridgeTaglineMark}>—</span>
                <span>Выбери своё. Примерь. Забронируй.</span>
                <span className={styles.bridgeTaglineMark}>—</span>
            </div>

            <div ref={cardRef} className={styles.bridgeCard}>
                <span className={styles.bridgeCardKicker}>ГЛАВА 01</span>
                <span className={styles.bridgeCardRule} />
                <span className={styles.bridgeCardTitle}>ВИЗУАЛИЗАТОР</span>
            </div>
        </div>
    );
}
