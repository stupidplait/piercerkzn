"use client";

/**
 * PageMotion (page12) — coordinator for page-level scroll-driven motion.
 *
 *   - Global scroll-progress hairline: writes `--scroll-progress` (0..1) on
 *     its own element and toggles `data-hidden` when the user is at the very
 *     top (avoids a half-pixel line at y=0).
 *   - Hero window 3D tilt: writes `--tx` / `--ty` on [data-hero-window]
 *     based on pointer position over the hero (max ±3°, damped).
 *   - Footer wordmark parallax: writes `--wordmark-shift` on the footer
 *     wordmark element based on its position in the viewport.
 *
 * All work happens inside a single rAF loop — no React state, no re-renders.
 * Respects `prefers-reduced-motion`.
 */

import { useEffect, useRef } from "react";
import styles from "./page.module.css";

export function PageMotion() {
    const barRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const reduce =
            typeof window !== "undefined" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce) return;

        const bar = barRef.current;
        const heroWindow = document.querySelector("[data-hero-window]") as HTMLElement | null;
        const wordmark = document.querySelector("[data-footer-wordmark]") as HTMLElement | null;
        const hero = document.querySelector("[data-hero-root]") as HTMLElement | null;

        // Damped pointer over the hero section (for tilt).
        let pxTarget = 0;
        let pyTarget = 0;
        let px = 0;
        let py = 0;

        const onMove = (e: PointerEvent) => {
            if (!hero) return;
            const r = hero.getBoundingClientRect();
            if (
                e.clientX < r.left ||
                e.clientX > r.right ||
                e.clientY < r.top ||
                e.clientY > r.bottom
            ) {
                // Pointer left hero — relax to 0.
                pxTarget = 0;
                pyTarget = 0;
                return;
            }
            pxTarget = ((e.clientX - r.left) / r.width) * 2 - 1;
            pyTarget = ((e.clientY - r.top) / r.height) * 2 - 1;
        };
        const onLeave = () => {
            pxTarget = 0;
            pyTarget = 0;
        };

        window.addEventListener("pointermove", onMove, { passive: true });
        window.addEventListener("pointerleave", onLeave, { passive: true });

        let raf = 0;
        let lastT = performance.now();
        const tick = () => {
            const now = performance.now();
            const dt = Math.min(0.05, (now - lastT) / 1000);
            lastT = now;

            // Scroll progress
            const vh = window.innerHeight || 1;
            const doc = Math.max(document.documentElement.scrollHeight - vh, 1);
            const y = window.scrollY;
            const p = Math.max(0, Math.min(1, y / doc));
            if (bar) {
                bar.style.setProperty("--scroll-progress", p.toFixed(4));
                bar.dataset.hidden = y < 4 ? "1" : "0";
            }

            // Damped tilt vars
            const k = 1 - Math.exp(-dt * 8);
            px += (pxTarget - px) * k;
            py += (pyTarget - py) * k;
            if (heroWindow) {
                // ±3.5° on Y (horizontal mouse) and ±2° on X (vertical mouse, inverted)
                heroWindow.style.setProperty("--ty", `${(px * 3.5).toFixed(3)}deg`);
                heroWindow.style.setProperty("--tx", `${(-py * 2).toFixed(3)}deg`);
            }

            // Wordmark parallax: shift ±4% based on how far into view it is.
            if (wordmark) {
                const r = wordmark.getBoundingClientRect();
                if (r.bottom > 0 && r.top < vh) {
                    const centre = r.top + r.height / 2;
                    const rel = (centre - vh / 2) / (vh / 2); // -1..1
                    const clamped = Math.max(-1, Math.min(1, rel));
                    wordmark.style.setProperty("--wordmark-shift", `${(clamped * -4).toFixed(2)}%`);
                }
            }

            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerleave", onLeave);
        };
    }, []);

    return <div ref={barRef} className={styles.scrollProgress} aria-hidden />;
}
