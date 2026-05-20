"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import styles from "./mechanics.module.css";
import type { MechanicProps } from "./types";

/**
 * 04 — Картотека / Vertical Rolodex.
 *
 * Right-edge strip showing prev / active / next pieces. When the active
 * piece changes the whole bar slides — old entries exit in the swap
 * direction, new entries enter from the opposite side. Direction is
 * derived from the previous active index so clicks on rail dots
 * (multi-step jumps) animate correctly too.
 *
 * Mouse wheel inside the strip steps; click halos step ±1; rail dots
 * jump directly to any index.
 */
export default function Rolodex({
    activeJewelry,
    items,
    triggerSwap,
    goToIndex,
    chapterRef: _chapterRef,
}: MechanicProps) {
    const stripRef = useRef<HTMLDivElement | null>(null);
    const wheelLockUntil = useRef(0);

    // Track previous active to derive direction (forward = slide up,
    // backward = slide down). Default to forward on first render.
    const prevActive = useRef(activeJewelry);
    const [direction, setDirection] = useState<1 | -1>(1);

    useEffect(() => {
        if (prevActive.current === activeJewelry) return;
        const total = items.length;
        const forward = (activeJewelry - prevActive.current + total) % total;
        const backward = (prevActive.current - activeJewelry + total) % total;
        setDirection(forward <= backward ? 1 : -1);
        prevActive.current = activeJewelry;
    }, [activeJewelry, items.length]);

    useEffect(() => {
        const el = stripRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            const now = Date.now();
            if (now < wheelLockUntil.current) {
                e.preventDefault();
                return;
            }
            if (Math.abs(e.deltaY) < 4) return;
            e.preventDefault();
            wheelLockUntil.current = now + 350;
            triggerSwap(e.deltaY > 0 ? 1 : -1);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [triggerSwap]);

    const total = items.length;
    const prevIdx = (activeJewelry - 1 + total) % total;
    const nextIdx = (activeJewelry + 1) % total;

    return (
        <div className={styles.rolodexRoot}>
            <div ref={stripRef} className={styles.rolodexStrip} aria-label="Список украшений">
                {/* Vertical rail (left edge of strip) — clickable position dots */}
                <div className={styles.rolodexRail} aria-hidden="true">
                    {items.map((item, i) => (
                        <button
                            key={item.id}
                            type="button"
                            className={styles.rolodexRailDot}
                            data-active={i === activeJewelry ? "true" : "false"}
                            onClick={() => goToIndex(i)}
                            aria-label={item.name}
                        />
                    ))}
                </div>

                {/* Sliding window — uses AnimatePresence so each entry plays
                    a real exit animation, making the bar visibly move on
                    swap rather than instantly remount. */}
                <div className={styles.rolodexWindow}>
                    <AnimatePresence initial={false} mode="popLayout" custom={direction}>
                        <motion.button
                            key={`prev-${prevIdx}`}
                            type="button"
                            className={styles.rolodexHalo}
                            data-pos="prev"
                            onClick={() => triggerSwap(-1)}
                            aria-label="Предыдущее"
                            custom={direction}
                            variants={haloVariants}
                            initial="enter"
                            animate="rest"
                            exit="exit"
                            transition={SLIDE_TRANSITION}
                        >
                            <span className={styles.rolodexHaloNum}>
                                {String(prevIdx + 1).padStart(2, "0")}
                            </span>
                            <span className={styles.rolodexHaloName}>{items[prevIdx].name}</span>
                        </motion.button>

                        <motion.div
                            key={`active-${activeJewelry}`}
                            className={styles.rolodexActive}
                            custom={direction}
                            variants={activeVariants}
                            initial="enter"
                            animate="rest"
                            exit="exit"
                            transition={SLIDE_TRANSITION}
                        >
                            <span className={styles.rolodexActiveNum}>
                                {String(activeJewelry + 1).padStart(2, "0")} /{" "}
                                {String(total).padStart(2, "0")}
                            </span>
                            <span className={styles.rolodexActiveName}>
                                {items[activeJewelry].name}
                            </span>
                            <span className={styles.rolodexActiveDot} />
                        </motion.div>

                        <motion.button
                            key={`next-${nextIdx}`}
                            type="button"
                            className={styles.rolodexHalo}
                            data-pos="next"
                            onClick={() => triggerSwap(1)}
                            aria-label="Следующее"
                            custom={direction}
                            variants={haloVariants}
                            initial="enter"
                            animate="rest"
                            exit="exit"
                            transition={SLIDE_TRANSITION}
                        >
                            <span className={styles.rolodexHaloNum}>
                                {String(nextIdx + 1).padStart(2, "0")}
                            </span>
                            <span className={styles.rolodexHaloName}>{items[nextIdx].name}</span>
                        </motion.button>
                    </AnimatePresence>
                </div>

                <p className={styles.rolodexHint}>
                    <span className={styles.hintMark}>↕</span> Колесо · клик · точка
                </p>
            </div>
        </div>
    );
}

/* Animation variants — direction = +1 (forward) makes new items rise
   from below and old items leave upward; direction = -1 reverses. */

const SLIDE_DISTANCE = 28; // px

const SLIDE_TRANSITION = {
    duration: 0.5,
    ease: [0.22, 0.9, 0.32, 1] as [number, number, number, number],
};

const activeVariants = {
    enter: (dir: 1 | -1) => ({
        opacity: 0,
        y: dir * SLIDE_DISTANCE,
        filter: "blur(6px)",
    }),
    rest: {
        opacity: 1,
        y: 0,
        filter: "blur(0px)",
    },
    exit: (dir: 1 | -1) => ({
        opacity: 0,
        y: dir * -SLIDE_DISTANCE,
        filter: "blur(6px)",
    }),
};

const haloVariants = {
    enter: (dir: 1 | -1) => ({
        opacity: 0,
        y: dir * SLIDE_DISTANCE * 0.7,
    }),
    rest: {
        opacity: 1,
        y: 0,
    },
    exit: (dir: 1 | -1) => ({
        opacity: 0,
        y: dir * -SLIDE_DISTANCE * 0.7,
    }),
};
