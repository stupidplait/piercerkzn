"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import baseStyles from "../new-design/page.module.css";
import styles from "./page.module.css";
import { useScrollReveal } from "../new-design/hooks/useScrollReveal";
import { playSwapTick } from "../new-design/audioFeedback";
import { JEWELRY_ITEMS } from "../new-design/JewelryShowcase";

interface JewelryShowcaseProps {
    chapterRef: React.RefObject<HTMLDivElement | null>;
    onJewelryChange?: (index: number) => void;
    onNameChange?: (name: string) => void;
    activeJewelry: number;
    transitionProgress: React.RefObject<number>;
    swapDirection: React.RefObject<number>;
    onTransitionStart?: () => void;
    onTransitionEnd?: () => void;
}

/**
 * Editorial-variant Chapter 1.
 *
 * Same swipe + transition mechanics as canonical, different layout: split
 * column. Left column carries the editorial copy + spec story; right
 * column hosts the 3D ring (rendered by the sticky canvas behind) plus
 * the roster dots. Mood: magazine spread.
 */
export default function JewelryShowcaseEditorial({
    chapterRef,
    onJewelryChange,
    onNameChange,
    activeJewelry,
    transitionProgress,
    swapDirection,
    onTransitionStart,
    onTransitionEnd,
}: JewelryShowcaseProps) {
    const { isVisible, progress } = useScrollReveal(chapterRef, { once: false });

    const swipeThreshold = 100;
    const lastSwapTime = useRef(0);
    const animFrameId = useRef<number | undefined>(undefined);

    const current = JEWELRY_ITEMS[activeJewelry];

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
                    onTransitionEnd?.();
                }
            };
            animFrameId.current = requestAnimationFrame(tick);
        },
        [transitionProgress, onTransitionEnd]
    );

    const triggerSwap = useCallback(
        (direction: number) => {
            const now = Date.now();
            if (now - lastSwapTime.current < 600) return;
            lastSwapTime.current = now;

            const next =
                direction > 0
                    ? (activeJewelry + 1) % JEWELRY_ITEMS.length
                    : (activeJewelry - 1 + JEWELRY_ITEMS.length) % JEWELRY_ITEMS.length;

            if (typeof navigator !== "undefined" && navigator.vibrate) {
                navigator.vibrate(10);
            }
            playSwapTick();
            swapDirection.current = direction;
            onTransitionStart?.();

            animateProgress(700, () => {
                onJewelryChange?.(next);
                onNameChange?.(JEWELRY_ITEMS[next].name);
            });
        },
        [
            activeJewelry,
            onJewelryChange,
            onNameChange,
            animateProgress,
            onTransitionStart,
            swapDirection,
        ]
    );

    useEffect(
        () => () => {
            if (animFrameId.current) cancelAnimationFrame(animFrameId.current);
        },
        []
    );

    useEffect(() => {
        const el = chapterRef.current;
        if (!el) return;

        let startX = 0;
        let startY = 0;
        let swiping = false;
        let directionLocked = false;
        let isHorizontal = false;

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
            if (directionLocked && isHorizontal && Math.abs(dx) > swipeThreshold) {
                triggerSwap(dx < 0 ? 1 : -1);
                swiping = false;
            }
        };
        const onPointerUp = () => {
            swiping = false;
        };

        const onTouchStart = (e: TouchEvent) => {
            swiping = true;
            directionLocked = false;
            isHorizontal = false;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        };
        const onTouchMove = (e: TouchEvent) => {
            if (!swiping) return;
            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;
            if (!directionLocked && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
                directionLocked = true;
                isHorizontal = Math.abs(dx) > Math.abs(dy);
            }
            if (directionLocked && isHorizontal && Math.abs(dx) > swipeThreshold) {
                triggerSwap(dx < 0 ? 1 : -1);
                swiping = false;
            }
        };
        const onTouchEnd = () => {
            swiping = false;
        };

        el.addEventListener("pointerdown", onPointerDown);
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
        el.addEventListener("touchstart", onTouchStart, { passive: true });
        window.addEventListener("touchmove", onTouchMove, { passive: true });
        window.addEventListener("touchend", onTouchEnd);

        return () => {
            el.removeEventListener("pointerdown", onPointerDown);
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
            el.removeEventListener("touchstart", onTouchStart);
            window.removeEventListener("touchmove", onTouchMove);
            window.removeEventListener("touchend", onTouchEnd);
        };
    }, [chapterRef, triggerSwap]);

    useEffect(() => {
        if (!isVisible) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") triggerSwap(-1);
            if (e.key === "ArrowRight") triggerSwap(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [isVisible, triggerSwap]);

    return (
        <div
            id="showcase"
            className={`${baseStyles.chapter} ${styles.editorialChapter}`}
            ref={chapterRef}
            data-visible={isVisible ? "1" : "0"}
            style={{ "--reveal-progress": Math.min(1, progress * 2) } as React.CSSProperties}
        >
            {/* Left column: editorial copy stack */}
            <aside className={styles.editorialCopy}>
                <div className={styles.editorialKicker}>
                    <span className={styles.editorialKickerNum}>01</span>
                    <span className={styles.editorialKickerRule} />
                    <span className={styles.editorialKickerLabel}>Визуализатор</span>
                </div>

                <h2 className={styles.editorialHeading}>
                    Шесть моделей.
                    <br />
                    Один материал —<br />
                    <em>твой выбор.</em>
                </h2>

                <p className={styles.editorialBody}>
                    Хирургическая сталь и титан медицинского класса — проверенные временем и кожей.
                    Подержи каждую модель в свете, рассмотри грань, услышь её историю.
                </p>

                <div className={styles.editorialHint}>
                    <span className={styles.editorialHintMark}>↔</span>
                    <span>Свайп · стрелки · перетаскивание</span>
                </div>
            </aside>

            {/* Right column: spec block (3D piece renders behind in sticky canvas) */}
            <div className={styles.editorialSpec}>
                <div className={styles.editorialSpecLine} />

                <div className={styles.editorialSpecBlock} key={current.id}>
                    <span className={styles.editorialSpecName}>{current.name}</span>
                    <dl className={styles.editorialSpecList}>
                        <div className={styles.editorialSpecRow}>
                            <dt>Материал</dt>
                            <dd>{current.material}</dd>
                        </div>
                        <div className={styles.editorialSpecRow}>
                            <dt>Калибр</dt>
                            <dd>{current.gauge}</dd>
                        </div>
                        <div className={styles.editorialSpecRow}>
                            <dt>Стиль</dt>
                            <dd>{current.style}</dd>
                        </div>
                        <div className={styles.editorialSpecRow}>
                            <dt>Вес</dt>
                            <dd>{current.weight}</dd>
                        </div>
                    </dl>
                    <span className={styles.editorialSpecPrice}>{current.price}</span>
                </div>

                {/* Roster pips — micro indicator strip */}
                <div className={styles.editorialPips}>
                    {JEWELRY_ITEMS.map((item, i) => (
                        <button
                            key={item.id}
                            type="button"
                            className={styles.editorialPip}
                            data-active={i === activeJewelry ? "true" : "false"}
                            onClick={() => {
                                if (i === activeJewelry) return;
                                triggerSwap(i > activeJewelry ? 1 : -1);
                            }}
                            aria-label={`Выбрать: ${item.name}`}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
