"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";

/**
 * TypeInText — monospace text that types in character-by-character.
 * Uses CSS `steps()` animation for crisp, mechanical feel matching
 * the HUD aesthetic. Falls back to full text for reduced motion.
 */
export default function TypeInText({
    text,
    delay = 0,
    speed = 40,
    className,
    visible = true,
}: {
    text: string;
    delay?: number;
    speed?: number;
    className?: string;
    visible?: boolean;
}) {
    const [displayed, setDisplayed] = useState("");
    const [showCursor, setShowCursor] = useState(true);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const indexRef = useRef(0);

    useEffect(() => {
        if (!visible) {
            setDisplayed("");
            indexRef.current = 0;
            setShowCursor(true);
            return;
        }

        const start = setTimeout(() => {
            const tick = () => {
                if (indexRef.current < text.length) {
                    indexRef.current++;
                    setDisplayed(text.slice(0, indexRef.current));
                    timerRef.current = setTimeout(tick, speed);
                } else {
                    // Blink cursor a few times then hide
                    setTimeout(() => setShowCursor(false), 1500);
                }
            };
            tick();
        }, delay);

        return () => {
            clearTimeout(start);
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, [text, delay, speed, visible]);

    return (
        <span className={`${styles.typeInText} ${className || ""}`}>
            {displayed}
            {showCursor && visible && <span className={styles.typeInCursor}>▌</span>}
        </span>
    );
}
