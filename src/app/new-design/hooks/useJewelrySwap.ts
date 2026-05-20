"use client";

import { useCallback, useEffect, useRef } from "react";
import { playSwapTick } from "../audioFeedback";
import { JEWELRY_ITEMS } from "../JewelryShowcase";

/**
 * Shared swap orchestration for any Chapter 1 picker UI.
 *
 * Encapsulates the canonical 700ms transition curve (35% peak — geometry
 * swap fires at the peak), audio tick + haptic, and 600ms throttle.
 *
 * `triggerSwap(direction)` — step ±1 around the ring.
 * `goToIndex(target)` — jump *directly* to a specific roster index;
 *   picks the shorter rotational direction so the 3D scene's
 *   `swapDirection` ref still gets a sensible value, but the new
 *   active index is the one the caller asked for (no multi-step walk).
 */
export function useJewelrySwap({
    activeJewelry,
    onJewelryChange,
    transitionProgress,
    swapDirection,
}: {
    activeJewelry: number;
    onJewelryChange: (index: number) => void;
    transitionProgress: React.RefObject<number>;
    swapDirection: React.RefObject<number>;
}) {
    const lastSwapTime = useRef(0);
    const animFrameId = useRef<number | undefined>(undefined);

    const animateProgress = useCallback(
        (duration: number, onMidpoint: () => void) => {
            const start = performance.now();
            const peakAt = 0.35;
            let midpointFired = false;

            const tick = (now: number) => {
                const elapsed = now - start;
                const t = Math.min(elapsed / duration, 1);

                let p: number;
                if (t < peakAt) {
                    const r = t / peakAt;
                    p = 1 - (1 - r) * (1 - r);
                } else {
                    const r = (t - peakAt) / (1 - peakAt);
                    p = 1 - r * r;
                }
                transitionProgress.current = Math.max(0, p);

                if (!midpointFired && t >= peakAt) {
                    midpointFired = true;
                    onMidpoint();
                }

                if (t < 1) {
                    animFrameId.current = requestAnimationFrame(tick);
                } else {
                    transitionProgress.current = 0;
                }
            };
            animFrameId.current = requestAnimationFrame(tick);
        },
        [transitionProgress]
    );

    /** Internal: animate to an explicit target index along a given direction. */
    const swapToIndex = useCallback(
        (target: number, direction: number) => {
            const now = Date.now();
            if (now - lastSwapTime.current < 600) return;
            lastSwapTime.current = now;

            if (typeof navigator !== "undefined" && navigator.vibrate) {
                navigator.vibrate(10);
            }
            playSwapTick();
            swapDirection.current = direction;

            animateProgress(700, () => {
                onJewelryChange(target);
            });
        },
        [animateProgress, onJewelryChange, swapDirection]
    );

    const triggerSwap = useCallback(
        (direction: number) => {
            const next =
                direction > 0
                    ? (activeJewelry + 1) % JEWELRY_ITEMS.length
                    : (activeJewelry - 1 + JEWELRY_ITEMS.length) % JEWELRY_ITEMS.length;
            swapToIndex(next, direction);
        },
        [activeJewelry, swapToIndex]
    );

    const goToIndex = useCallback(
        (target: number) => {
            if (target === activeJewelry) return;
            const len = JEWELRY_ITEMS.length;
            const forward = (target - activeJewelry + len) % len;
            const backward = (activeJewelry - target + len) % len;
            const direction = forward <= backward ? 1 : -1;
            swapToIndex(target, direction);
        },
        [activeJewelry, swapToIndex]
    );

    useEffect(
        () => () => {
            if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
        },
        []
    );

    return { triggerSwap, goToIndex };
}
