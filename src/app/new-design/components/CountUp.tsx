"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";

/**
 * CountUp — numeric counter that ticks from 0 to target value
 * when `active` becomes true. Uses easeOutExpo for the "fast
 * start, slow finish" feel seen in HUD readouts.
 */
export default function CountUp({
    to,
    prefix = "",
    suffix = "",
    duration = 1200,
    active = false,
    className,
}: {
    to: number;
    prefix?: string;
    suffix?: string;
    duration?: number;
    active?: boolean;
    className?: string;
}) {
    const [value, setValue] = useState(0);
    const rafRef = useRef<number | undefined>(undefined);
    const hasAnimated = useRef(false);

    useEffect(() => {
        if (!active) {
            // Don't reset — keep the last displayed value to avoid
            // jarring jumps when scrolling back and forth.
            return;
        }

        // Skip re-animation if already completed for this target
        if (hasAnimated.current) return;

        const start = performance.now();
        const tick = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // easeOutExpo
            const eased = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
            setValue(Math.round(eased * to));
            if (progress < 1) {
                rafRef.current = requestAnimationFrame(tick);
            } else {
                hasAnimated.current = true;
            }
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [active, to, duration]);

    return (
        <span className={`${styles.countUp} ${className || ""}`}>
            {prefix}
            {String(value).padStart(2, "0")}
            {suffix}
        </span>
    );
}
