"use client";

/**
 * BalenciagaPortfolio (page12) — coverflow with smooth multi-step snap.
 *
 *   - Scrolling up OUT of the section always releases control (no approach-snap).
 *   - Scrolling down OUT releases control too.
 *   - Rapid wheel inside the pin accumulates into a queue: each tick adds one
 *     step, and the rAF tween re-targets the running animation, so scrolling
 *     "a lot" jumps many cards fluidly instead of crawling one-by-one.
 *   - 0.65s name reveal on index stability.
 */

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

type Size = "big" | "medium" | "small";
type Tone = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
type Item = { n: string; tag: string; meta: string; tone: Tone; size: Size };

const items: Item[] = [
    { n: "001", tag: "HELIX", meta: "УХО · 2026", tone: "a", size: "big" },
    { n: "002", tag: "SEPTUM", meta: "НОС · 2026", tone: "b", size: "medium" },
    { n: "003", tag: "DAITH", meta: "УХО · 2025", tone: "c", size: "big" },
    { n: "004", tag: "CONCH", meta: "УХО · 2026", tone: "d", size: "small" },
    { n: "005", tag: "LABRET", meta: "ЛИЦО · 2025", tone: "e", size: "medium" },
    {
        n: "006",
        tag: "INDUSTRIAL",
        meta: "УХО · 2026",
        tone: "f",
        size: "small",
    },
    { n: "007", tag: "ROOK", meta: "УХО · 2026", tone: "g", size: "big" },
    { n: "008", tag: "TRAGUS", meta: "УХО · 2025", tone: "h", size: "medium" },
    { n: "009", tag: "MEDUSA", meta: "ЛИЦО · 2026", tone: "a", size: "big" },
    { n: "010", tag: "NOSTRIL", meta: "НОС · 2025", tone: "c", size: "small" },
    { n: "011", tag: "NAVEL", meta: "ТЕЛО · 2026", tone: "e", size: "medium" },
    { n: "012", tag: "EYEBROW", meta: "ЛИЦО · 2026", tone: "g", size: "big" },
];

const N = items.length;
const STEP_VW = 46;
const VH_PER_CARD = 0.9;
const NAME_REVEAL_MS = 140;
const SETTLE_POLL_MS = 60;
const QUEUE_RESET_MS = 260;
const TWEEN_MS = 520;
const TOUCH_STEP = 50;

function ease(t: number) {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export function BalenciagaPortfolio() {
    const sectionRef = useRef<HTMLElement>(null);
    const cardsRef = useRef<(HTMLLIElement | null)[]>([]);
    const ambientRef = useRef<HTMLDivElement>(null);
    const [active, setActive] = useState(0);
    const [settledIdx, setSettledIdx] = useState<number | null>(0);
    const tweeningRef = useRef(false);

    useEffect(() => {
        const sec = sectionRef.current;
        if (!sec) return;

        const setHeight = () => {
            sec.style.height = `${100 + (N - 1) * VH_PER_CARD * 100}vh`;
        };
        setHeight();

        // rAF tween for scroll position
        let tweenFrom = 0;
        let tweenTo = 0;
        let tweenStart = 0;
        let tweenRaf = 0;

        const runTween = (to: number) => {
            tweenFrom = window.scrollY;
            tweenTo = to;
            tweenStart = performance.now();
            tweeningRef.current = true;
            cancelAnimationFrame(tweenRaf);
            const step = () => {
                const now = performance.now();
                const k = Math.min(1, (now - tweenStart) / TWEEN_MS);
                const y = tweenFrom + (tweenTo - tweenFrom) * ease(k);
                window.scrollTo(0, y);
                if (k < 1) tweenRaf = requestAnimationFrame(step);
                else tweeningRef.current = false;
            };
            tweenRaf = requestAnimationFrame(step);
        };

        const getCardPx = () => (sec.offsetHeight - window.innerHeight) / (N - 1);
        const anchor = () => sec.offsetTop;

        const getCurrentIndex = () => {
            const total = sec.offsetHeight - window.innerHeight;
            if (total <= 0) return 0;
            const scrolled = -sec.getBoundingClientRect().top;
            return Math.max(0, Math.min(N - 1, (scrolled / total) * (N - 1)));
        };

        const snapToIndex = (idx: number) => {
            const clamped = Math.max(0, Math.min(N - 1, idx));
            runTween(anchor() + clamped * getCardPx());
        };

        const applyTransforms = (t: number) => {
            for (let i = 0; i < N; i++) {
                const li = cardsRef.current[i];
                if (!li) continue;
                const d = i - t;
                const abs = Math.abs(d);
                const isCenter = abs < 0.5;
                li.dataset.center = isCenter ? "1" : "0";

                if (abs > 5.5) {
                    const park = d < 0 ? -260 : 260;
                    li.style.transform = `translate(-50%, -50%) translateX(${park}vw) scale(0.2)`;
                    li.style.opacity = "0";
                    li.style.zIndex = "0";
                    continue;
                }

                const s = Math.max(0.22, 1 - 0.28 * Math.pow(abs, 0.85));
                const x = d * STEP_VW;
                li.style.transform = `translate(-50%, -50%) translateX(${x}vw) scale(${s})`;
                li.style.zIndex = String(Math.round(s * 100));
                const edgeFade = abs > 4 ? Math.max(0, 1 - (abs - 4) * 0.9) : 1;
                const dim = isCenter ? 1 : Math.max(0.42, 1 - abs * 0.18);
                li.style.opacity = String(Math.min(edgeFade, dim));
            }
            if (ambientRef.current) {
                const pct = N > 1 ? Math.max(0, Math.min(1, t / (N - 1))) : 0;
                ambientRef.current.style.setProperty("--bal-progress", pct.toFixed(4));
            }
        };

        let pending = false;
        let rafId = 0;
        const compute = () => {
            pending = false;
            const t = getCurrentIndex();
            applyTransforms(t);
            const idx = Math.round(t);
            setActive((prev) => (prev === idx ? prev : idx));
        };
        const onScroll = () => {
            if (pending) return;
            pending = true;
            rafId = requestAnimationFrame(compute);
        };

        const engaged = () => {
            const r = sec.getBoundingClientRect();
            return r.top <= 1 && r.bottom > window.innerHeight;
        };

        // Multi-step queue — rapid input accumulates.
        let queuedTarget: number | null = null;
        let lastInputAt = 0;
        const queueStep = (dir: 1 | -1): boolean => {
            const now = performance.now();
            const base =
                queuedTarget != null && now - lastInputAt < QUEUE_RESET_MS
                    ? queuedTarget
                    : Math.round(getCurrentIndex());
            const next = base + dir;
            if (next < 0 || next > N - 1) return false;
            queuedTarget = next;
            lastInputAt = now;
            snapToIndex(next);
            return true;
        };

        const onWheel = (e: WheelEvent) => {
            if (!engaged()) return;
            const dir: 1 | -1 | 0 = e.deltaY > 0 ? 1 : e.deltaY < 0 ? -1 : 0;
            if (!dir) return;
            const t = getCurrentIndex();
            // Release at edges so user can exit up OR down.
            if (dir > 0 && t >= N - 1 - 0.01) return;
            if (dir < 0 && t <= 0.01) return;
            e.preventDefault();
            queueStep(dir);
        };

        const onKey = (e: KeyboardEvent) => {
            if (!engaged()) return;
            let dir: 1 | -1 | 0 = 0;
            if (
                e.key === "ArrowRight" ||
                e.key === "ArrowDown" ||
                e.key === "PageDown" ||
                e.key === " "
            )
                dir = 1;
            else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") dir = -1;
            if (!dir) return;
            e.preventDefault();
            queueStep(dir);
        };

        let touchStartY: number | null = null;
        const onTouchStart = (e: TouchEvent) => {
            if (!engaged()) return;
            touchStartY = e.touches[0]?.clientY ?? null;
        };
        const onTouchMove = (e: TouchEvent) => {
            if (touchStartY == null || !engaged()) return;
            const y = e.touches[0]?.clientY ?? touchStartY;
            const dy = touchStartY - y;
            if (Math.abs(dy) < TOUCH_STEP) return;
            const dir: 1 | -1 = dy > 0 ? 1 : -1;
            e.preventDefault();
            if (queueStep(dir)) touchStartY = y;
        };
        const onTouchEnd = () => {
            touchStartY = null;
        };

        const onResize = () => {
            setHeight();
            onScroll();
        };

        compute();
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onResize);
        // Scope wheel to the section so trackpad momentum outside the pin
        // isn't hijacked. `engaged()` still gates the actual snap so the
        // tall (multi-viewport) section doesn't consume wheel events near
        // its edges.
        sec.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("keydown", onKey);
        sec.addEventListener("touchstart", onTouchStart, { passive: true });
        sec.addEventListener("touchmove", onTouchMove, { passive: false });
        sec.addEventListener("touchend", onTouchEnd);

        return () => {
            cancelAnimationFrame(rafId);
            cancelAnimationFrame(tweenRaf);
            tweeningRef.current = false;
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onResize);
            sec.removeEventListener("wheel", onWheel);
            window.removeEventListener("keydown", onKey);
            sec.removeEventListener("touchstart", onTouchStart);
            sec.removeEventListener("touchmove", onTouchMove);
            sec.removeEventListener("touchend", onTouchEnd);
        };
    }, []);

    useEffect(() => {
        // Hide the overlay name immediately when the active index changes
        // (including mid-fling across many cards). Reveal only after a
        // stable period during which no tween is running. This guarantees
        // no name is ever shown during a scroll flurry.
        setSettledIdx(null);
        let cancelled = false;
        let pollTimer = 0;
        let revealTimer = 0;

        const tryReveal = () => {
            if (cancelled) return;
            if (tweeningRef.current) {
                pollTimer = window.setTimeout(tryReveal, SETTLE_POLL_MS);
                return;
            }
            revealTimer = window.setTimeout(() => {
                if (!cancelled) setSettledIdx(active);
            }, NAME_REVEAL_MS);
        };
        tryReveal();

        return () => {
            cancelled = true;
            window.clearTimeout(pollTimer);
            window.clearTimeout(revealTimer);
        };
    }, [active]);

    return (
        <section ref={sectionRef} className={styles.bal} id="portfolio">
            <div className={styles.balPin}>
                <ul className={styles.balCards}>
                    {items.map((it, i) => (
                        <li
                            key={it.n}
                            ref={(el) => {
                                cardsRef.current[i] = el;
                            }}
                            className={styles.balCard}
                            data-tone={it.tone}
                            data-size={it.size}
                        >
                            <span
                                className={styles.balCardName}
                                data-settled={settledIdx === i ? "1" : "0"}
                            >
                                {it.tag}
                            </span>
                            <div className={styles.balPortrait} />
                        </li>
                    ))}
                </ul>
                <div ref={ambientRef} className={styles.balAmbient} />
            </div>
        </section>
    );
}
