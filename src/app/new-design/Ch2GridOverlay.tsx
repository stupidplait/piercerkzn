"use client";

import { useEffect, useRef } from "react";
import styles from "./page.module.css";

interface Ch2GridOverlayProps {
    /* Drives the 2D-grid slide-in. 0 = off-screen below, 1 = fully
       slid up and settled. Read every frame; the overlay's transform
       + opacity are mutated directly to avoid React re-renders. */
    ch2BodyPhase: React.RefObject<number>;
}

/**
 * Ch2GridOverlay — the 2D HTML grid that slides up from the bottom
 * to take over from the held 3D floor close-up. Style is alche.studio-
 * referenced: a vertical translation with a subtle squash-into-place
 * "change effect" rather than a flat fade.
 *
 * Lifecycle across ch2BodyPhase (0 = top of Ch2, 1 = top of Ch3):
 *   • 0.00 → 0.18   slide IN from bottom
 *                   • translate Y 100% → 0%
 *                   • scale Y 1.15 → 1.00 (squash + settle)
 *                   • opacity 0 → 1
 *   • 0.18 → 0.82   held — grid is the section's background
 *   • 0.82 → 1.00   slide OUT downward as the user enters Ch3
 *                   • translate Y 0% → 100%
 *                   • opacity 1 → 0
 *
 * The 3D canvas keeps rendering underneath; the grid covers it once
 * fully translated up, then uncovers it on exit.
 */
export default function Ch2GridOverlay({ ch2BodyPhase }: Ch2GridOverlayProps) {
    const overlayRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let raf = 0;
        const tick = () => {
            const ph = ch2BodyPhase.current ?? 0;

            // Slide-in 0 → 0.18
            const inT = Math.max(0, Math.min(1, ph / 0.18));
            const inEased = inT * inT * (3 - 2 * inT);

            // Slide-out 0.82 → 1.00 (mirror motion: 100% bottom, 1.15 squash)
            const outT = Math.max(0, Math.min(1, (ph - 0.82) / 0.18));
            const outEased = outT * outT * (3 - 2 * outT);

            const overlay = overlayRef.current;
            if (overlay) {
                // Slide is the difference: in-progress minus out-progress.
                const translateY = (1 - inEased) * 100 + outEased * 100;
                overlay.style.setProperty("--grid-translate", `${translateY}%`);
                // Squash on entry; resolve on hold; small squash on exit.
                const scaleY = inEased < 1 ? 1.15 - 0.15 * inEased : 1.0 + 0.1 * outEased;
                overlay.style.setProperty("--grid-scale-y", String(scaleY));
                // Visible during entry + hold; fades out during exit.
                overlay.style.setProperty("--grid-opacity", String(inEased * (1 - outEased)));
            }
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [ch2BodyPhase]);

    return <div ref={overlayRef} className={styles.ch2GridOverlay} aria-hidden="true" />;
}
