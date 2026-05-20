"use client";

import { useCallback, useEffect, useRef } from "react";
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
 * Cinematic-variant Chapter 1.
 *
 * Three vertical acts pinned within a ~250vh chapter:
 *   Act 1 — Знакомство — first piece + RU material poetry.
 *   Act 2 — Коллекция — swipe carousel (current canonical mechanic).
 *   Act 3 — Деталь — full spec sheet (gauge, material, care notes, price).
 *
 * Top + bottom letterbox bars frame the 3D piece behind. Spec text lives
 * in the lower bar in Acts 1+2; Act 3 expands a full hud panel.
 */
export default function JewelryShowcaseCinematic({
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

    // Swipe only inside Act 2 (the carousel act)
    useEffect(() => {
        const el = document.getElementById("cine-act-collection");
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
    }, [triggerSwap]);

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
            className={`${baseStyles.chapter} ${styles.cineChapter}`}
            ref={chapterRef}
            data-visible={isVisible ? "1" : "0"}
            style={{ "--reveal-progress": Math.min(1, progress * 2) } as React.CSSProperties}
        >
            {/* Letterbox bars — top + bottom, framing the 3D scene behind */}
            <div className={styles.cineLetterboxTop} aria-hidden="true">
                <span className={styles.cineLetterboxKicker}>ГЛАВА 01</span>
                <span className={styles.cineLetterboxRule} />
                <span className={styles.cineLetterboxLabel}>ВИЗУАЛИЗАТОР</span>
            </div>
            <div className={styles.cineLetterboxBottom} aria-hidden="true">
                <span className={styles.cineLetterboxName}>{current.name}</span>
                <span className={styles.cineLetterboxMeta}>
                    {current.material} · {current.gauge}
                </span>
                <span className={styles.cineLetterboxPrice}>{current.price}</span>
            </div>

            {/* ── Act 1 — Знакомство ── */}
            <article id="cine-act-meet" className={styles.cineAct} data-act="1">
                <div className={styles.cineActInner}>
                    <div className={styles.cineActLabel}>
                        <span className={styles.cineActNum}>I</span>
                        <span>Знакомство</span>
                    </div>
                    <h3 className={styles.cineActHeading}>
                        Хирургическая сталь,
                        <br />
                        <em>выкованная для тебя.</em>
                    </h3>
                    <p className={styles.cineActBody}>
                        Каждое украшение в коллекции — медицинский класс, проверенный пирсингом.
                        Подержи в свете, рассмотри грань.
                    </p>
                </div>
            </article>

            {/* ── Act 2 — Коллекция ── */}
            <article id="cine-act-collection" className={styles.cineAct} data-act="2">
                <div className={styles.cineActInner}>
                    <div className={styles.cineActLabel}>
                        <span className={styles.cineActNum}>II</span>
                        <span>Коллекция</span>
                    </div>
                    <h3 className={styles.cineActHeading}>
                        Шесть моделей.
                        <br />
                        <em>Каждая — твоя история.</em>
                    </h3>

                    {/* Roster row */}
                    <div className={styles.cineRoster}>
                        {JEWELRY_ITEMS.map((item, i) => (
                            <button
                                key={item.id}
                                type="button"
                                className={styles.cineRosterItem}
                                data-active={i === activeJewelry ? "true" : "false"}
                                onClick={() => {
                                    if (i === activeJewelry) return;
                                    triggerSwap(i > activeJewelry ? 1 : -1);
                                }}
                            >
                                <span className={styles.cineRosterItemNum}>
                                    {String(i + 1).padStart(2, "0")}
                                </span>
                                <span className={styles.cineRosterItemName}>{item.name}</span>
                            </button>
                        ))}
                    </div>

                    <div className={styles.cineSwipeHint}>
                        <span className={styles.cineSwipeHintMark}>↔</span>
                        <span>Свайп · стрелки</span>
                    </div>
                </div>
            </article>

            {/* ── Act 3 — Деталь ── */}
            <article id="cine-act-detail" className={styles.cineAct} data-act="3">
                <div className={styles.cineActInner}>
                    <div className={styles.cineActLabel}>
                        <span className={styles.cineActNum}>III</span>
                        <span>Деталь</span>
                    </div>
                    <h3 className={styles.cineActHeading} key={current.id}>
                        {current.name}
                    </h3>
                    <dl className={styles.cineSpecList} key={`${current.id}-spec`}>
                        <div className={styles.cineSpecRow}>
                            <dt>Материал</dt>
                            <dd>{current.material}</dd>
                        </div>
                        <div className={styles.cineSpecRow}>
                            <dt>Калибр</dt>
                            <dd>{current.gauge}</dd>
                        </div>
                        <div className={styles.cineSpecRow}>
                            <dt>Стиль</dt>
                            <dd>{current.style}</dd>
                        </div>
                        <div className={styles.cineSpecRow}>
                            <dt>Вес</dt>
                            <dd>{current.weight}</dd>
                        </div>
                        <div className={styles.cineSpecRow}>
                            <dt>Уход</dt>
                            <dd>Не снимать 4–6 недель</dd>
                        </div>
                    </dl>
                    <div className={styles.cinePriceLine}>
                        <span className={styles.cinePriceLabel}>Цена</span>
                        <span className={styles.cinePriceValue}>{current.price}</span>
                    </div>
                </div>
            </article>
        </div>
    );
}
