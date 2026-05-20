"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Scroll-driven reveal hook — returns `isVisible` when element enters
 * the viewport, and `progressRef` (0→1) as a ref (no re-renders).
 * Also returns a `progress` state for components that need React re-renders,
 * but throttled to ~20fps to avoid jank from 120Hz scroll events.
 *
 * @param threshold - fraction of element visible to trigger (default 0.15)
 * @param once - if true, stays visible after first trigger (default true)
 */
export function useScrollReveal(
    ref: RefObject<HTMLElement | null>,
    { threshold = 0.15, once = true } = {}
): { isVisible: boolean; progress: number; progressRef: React.RefObject<number> } {
    const [isVisible, setIsVisible] = useState(false);
    const [progress, setProgress] = useState(0);
    const progressRef = useRef(0);
    const hasTriggered = useRef(false);
    const lastUpdateTime = useRef(0);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    if (!hasTriggered.current || !once) {
                        setIsVisible(true);
                        hasTriggered.current = true;
                    }
                } else if (!once) {
                    setIsVisible(false);
                }
            },
            { threshold }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [ref, threshold, once]);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        let rafId: number;
        const onScroll = () => {
            rafId = requestAnimationFrame(() => {
                const rect = el.getBoundingClientRect();
                const vh = window.innerHeight;
                // 0 when top hits viewport bottom, 1 when top hits viewport top
                const raw = 1 - rect.top / vh;
                const clamped = Math.max(0, Math.min(1, raw));

                // Always update the ref (no re-render cost)
                progressRef.current = clamped;

                // Throttle setState to ~20fps to avoid jank
                const now = performance.now();
                if (now - lastUpdateTime.current > 50) {
                    lastUpdateTime.current = now;
                    setProgress(clamped);
                }
            });
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        onScroll();
        return () => {
            window.removeEventListener("scroll", onScroll);
            cancelAnimationFrame(rafId);
        };
    }, [ref]);

    return { isVisible, progress, progressRef };
}
