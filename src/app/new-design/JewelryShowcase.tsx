"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import styles from "./page.module.css";
import { useScrollReveal } from "./hooks/useScrollReveal";
import { useJewelrySwap } from "./hooks/useJewelrySwap";

/* Roster aligned 1:1 with PIECE_GEOMETRIES in WireframeRoom.tsx — index 0
   is the hero floating torus ring, so what the user sees in hero IS the
   first carousel item once they scroll into Chapter 1. The old "Кольцо"
   (hoop earring) entry has been dropped + makeHoopEarring removed from
   PIECE_GEOMETRIES; "Кольцо" now refers to the hero torus ring. */
const ROSTER = [
    {
        id: "ring",
        name: "Кольцо",
        material: "Хирургическая сталь",
        gauge: "18G",
        weight: "1.0г",
        style: "Минимализм",
        price: "₽3,200",
    },
    {
        id: "cross-earring",
        name: "Крест-серьга",
        material: "Хирургическая сталь",
        gauge: "18G",
        weight: "1.2г",
        style: "Готика",
        price: "₽2,800",
    },
    {
        id: "labret",
        name: "Лабрет",
        material: "Титан ASTM F136",
        gauge: "16G",
        weight: "0.8г",
        style: "Минимализм",
        price: "₽1,900",
    },
    {
        id: "stud-earring",
        name: "Пусета",
        material: "Титан с цирконием",
        gauge: "20G",
        weight: "0.6г",
        style: "Элегант",
        price: "₽4,500",
    },
    {
        id: "barbell",
        name: "Штанга",
        material: "Титан ASTM F136",
        gauge: "14G",
        weight: "1.8г",
        style: "Индастриал",
        price: "₽2,400",
    },
    {
        id: "septum-ring",
        name: "Септум",
        material: "Хирургическая сталь",
        gauge: "16G",
        weight: "1.1г",
        style: "Этника",
        price: "₽3,600",
    },
];

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

/* Spring-based transition for gesture-driven swaps (swipe, wheel).
   `spring-for-gestures` rule: gesture motion must use springs to
   preserve input velocity. `duration-max-300ms`: user-initiated
   animations must complete within 300ms. */
const SLIDE_TRANSITION = {
    type: "spring" as const,
    stiffness: 500,
    damping: 32,
    mass: 0.8,
};

const INSTANT_TRANSITION = { duration: 0 };

const SLIDE_DISTANCE = 28;

const activeVariants = {
    enter: (dir: 1 | -1) => ({ opacity: 0, y: dir * SLIDE_DISTANCE }),
    rest: { opacity: 1, y: 0 },
    exit: (dir: 1 | -1) => ({ opacity: 0, y: dir * -SLIDE_DISTANCE }),
};

const haloVariants = {
    enter: (dir: 1 | -1) => ({ opacity: 0, y: dir * SLIDE_DISTANCE * 0.7 }),
    rest: { opacity: 1, y: 0 },
    exit: (dir: 1 | -1) => ({ opacity: 0, y: dir * -SLIDE_DISTANCE * 0.7 }),
};

export default function JewelryShowcase({
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
    const prefersReducedMotion = useReducedMotion();
    const transition = prefersReducedMotion ? INSTANT_TRANSITION : SLIDE_TRANSITION;

    const swipeThreshold = 100;

    const current = ROSTER[activeJewelry];

    const handleJewelryChange = (next: number) => {
        onJewelryChange?.(next);
        onNameChange?.(ROSTER[next].name);
        onTransitionEnd?.();
    };

    const { triggerSwap, goToIndex } = useJewelrySwap({
        activeJewelry,
        onJewelryChange: handleJewelryChange,
        transitionProgress,
        swapDirection,
    });

    // Wrap triggerSwap to fire onTransitionStart for backward compatibility.
    const swipeRef = useRef(triggerSwap);
    swipeRef.current = triggerSwap;

    const wrappedTriggerSwap = (direction: number) => {
        onTransitionStart?.();
        swipeRef.current(direction);
    };

    // Direction tracking for the Rolodex sliding animation. Recomputed
    // when activeJewelry changes (covers swipe steps AND rail-dot jumps).
    const prevActive = useRef(activeJewelry);
    const [direction, setDirection] = useState<1 | -1>(1);
    useEffect(() => {
        if (prevActive.current === activeJewelry) return;
        const total = ROSTER.length;
        const forward = (activeJewelry - prevActive.current + total) % total;
        const backward = (prevActive.current - activeJewelry + total) % total;
        setDirection(forward <= backward ? 1 : -1);
        prevActive.current = activeJewelry;
    }, [activeJewelry]);

    // Wheel scroll on the Rolodex strip — bound to the strip element only
    // so it doesn't fight the page-level smooth-scroll system. Throttled
    // so a single wheel burst yields one swap.
    const rolodexRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = rolodexRef.current;
        if (!el) return;
        let lockUntil = 0;
        const onWheel = (e: WheelEvent) => {
            // Always consume the event over the rolodex strip — both
            // preventDefault (browser scroll) and stopPropagation (the
            // page-level wheel listener on window). Without the latter
            // the page smooth-scroll system also receives the event and
            // scrolls the page even while the rolodex handles it.
            e.preventDefault();
            e.stopPropagation();
            const now = Date.now();
            if (now < lockUntil) return;
            if (Math.abs(e.deltaY) < 4) return;
            lockUntil = now + 350;
            wrappedTriggerSwap(e.deltaY > 0 ? 1 : -1);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
        // wrappedTriggerSwap is recreated every render; only the latest
        // reference is captured here, which is the desired behavior.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Swipe gesture (full chapter container)
    useEffect(() => {
        const el = chapterRef.current;
        if (!el) return;

        let startX = 0,
            startY = 0;
        let swiping = false;
        let directionLocked = false;
        let isHorizontal = false;

        const onPointerDown = (e: PointerEvent) => {
            // Don't fight the rail/halo button clicks
            if ((e.target as HTMLElement)?.closest("button")) return;
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
                wrappedTriggerSwap(dx < 0 ? 1 : -1);
                swiping = false;
            }
        };
        const onPointerUp = () => {
            swiping = false;
        };

        const onTouchStart = (e: TouchEvent) => {
            if ((e.target as HTMLElement)?.closest("button")) return;
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
                wrappedTriggerSwap(dx < 0 ? 1 : -1);
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
    }, [chapterRef]);

    useEffect(() => {
        if (!isVisible) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowLeft") wrappedTriggerSwap(-1);
            if (e.key === "ArrowRight") wrappedTriggerSwap(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
        // wrappedTriggerSwap is recreated each render but only the latest
        // is captured in the closure; that's fine for arrow keys.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVisible]);

    const total = ROSTER.length;
    const prevIdx = (activeJewelry - 1 + total) % total;
    const nextIdx = (activeJewelry + 1) % total;

    return (
        <div
            id="showcase"
            className={`${styles.chapter} ${styles.charSelect}`}
            ref={chapterRef}
            data-visible={isVisible ? "1" : "0"}
            style={
                {
                    "--reveal-progress": Math.max(0, Math.min(1, (progress - 0.6) * 2.5)),
                } as React.CSSProperties
            }
        >
            {/* Instrument nameplate — bottom-left museum-caption block.
                Replaces the previous "ГЛАВА 01 | ВЫБЕРИ" pill which was
                redundant with the 3D ВЫБЕРИ floating in the canvas.
                Surfaces the active piece's instrument specs (material,
                gauge · weight, price) in the medical-spec register. */}
            <div className={styles.nameplate} aria-live="polite">
                <span className={styles.nameplateMaterial}>{current.material}</span>
                <span className={styles.nameplateRule} aria-hidden="true" />
                <span className={styles.nameplateSpec}>
                    {current.gauge} · {current.weight}
                </span>
                <span className={styles.nameplatePrice}>{current.price}</span>
            </div>

            {/* Rolodex picker — right-edge strip with rail + sliding window */}
            <div ref={rolodexRef} className={styles.rolodex} aria-label="Список украшений">
                <div className={styles.rolodexRail}>
                    {ROSTER.map((item, i) => (
                        <button
                            key={item.id}
                            type="button"
                            className={styles.rolodexRailDot}
                            data-active={i === activeJewelry ? "true" : "false"}
                            onClick={() => goToIndex(i)}
                            aria-label={item.name}
                        >
                            <span className={styles.rolodexRailDotMark} aria-hidden="true" />
                        </button>
                    ))}
                </div>

                <div className={styles.rolodexWindow}>
                    <AnimatePresence initial={false} mode="popLayout" custom={direction}>
                        <motion.button
                            key={`prev-${prevIdx}`}
                            type="button"
                            className={styles.rolodexHalo}
                            data-pos="prev"
                            onClick={() => wrappedTriggerSwap(-1)}
                            aria-label="Предыдущее"
                            custom={direction}
                            variants={haloVariants}
                            initial="enter"
                            animate="rest"
                            exit="exit"
                            transition={transition}
                        >
                            <span className={styles.rolodexHaloNum}>
                                {String(prevIdx + 1).padStart(2, "0")}
                            </span>
                            <span className={styles.rolodexHaloName}>{ROSTER[prevIdx].name}</span>
                        </motion.button>

                        <motion.div
                            key={`active-${activeJewelry}`}
                            className={styles.rolodexActive}
                            custom={direction}
                            variants={activeVariants}
                            initial="enter"
                            animate="rest"
                            exit="exit"
                            transition={transition}
                        >
                            <span className={styles.rolodexActiveNum}>
                                {String(activeJewelry + 1).padStart(2, "0")} /{" "}
                                {String(total).padStart(2, "0")}
                            </span>
                            <span className={styles.rolodexActiveName}>{current.name}</span>
                            <span className={styles.rolodexActiveDot} aria-hidden="true" />
                        </motion.div>

                        <motion.button
                            key={`next-${nextIdx}`}
                            type="button"
                            className={styles.rolodexHalo}
                            data-pos="next"
                            onClick={() => wrappedTriggerSwap(1)}
                            aria-label="Следующее"
                            custom={direction}
                            variants={haloVariants}
                            initial="enter"
                            animate="rest"
                            exit="exit"
                            transition={transition}
                        >
                            <span className={styles.rolodexHaloNum}>
                                {String(nextIdx + 1).padStart(2, "0")}
                            </span>
                            <span className={styles.rolodexHaloName}>{ROSTER[nextIdx].name}</span>
                        </motion.button>
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
}

export { ROSTER as JEWELRY_ITEMS };
