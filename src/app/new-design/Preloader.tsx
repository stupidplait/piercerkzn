"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

/* ─── Timing ─────────────────────────────────────────────── */
const MIN_DISPLAY_MS = 2000;

const GRID_DELAY = 0;
const AXES_DELAY = 120;
const TORUS_DELAY = 280;
const LABEL_DELAY = 700;

/* ─── SVG geometry ───────────────────────────────────────── */
const VW = 800,
    VH = 500;
const CX = VW / 2,
    CY = VH / 2;
const SWEEP_R = 130; // torus sweep-circle radius
const TUBE_R = 22; // tube cross-section radius
const N_SECTIONS = 8; // cross-section indicators

/** SVG arc shorthand — two-semicircle full circle. */
function arc(cx: number, cy: number, r: number): string {
    return (
        `M ${cx + r} ${cy} ` +
        `A ${r} ${r} 0 1 1 ${cx - r} ${cy} ` +
        `A ${r} ${r} 0 1 1 ${cx + r} ${cy}`
    );
}

/** Perspective corridor vanishing lines + horizontal reference bands. */
function gridPaths(): string[] {
    const p: string[] = [];
    // Corner diagonals → center (corridor convergence)
    p.push(`M 0 0 L ${CX} ${CY}`, `M ${VW} 0 L ${CX} ${CY}`);
    p.push(`M 0 ${VH} L ${CX} ${CY}`, `M ${VW} ${VH} L ${CX} ${CY}`);
    // Horizontal reference bands (perspective depth)
    for (const f of [0.12, 0.28, 0.72, 0.88]) {
        const y = VH * f;
        const hw = VW * 0.5 * (0.25 + (Math.abs(f - 0.5) / 0.5) * 0.75);
        p.push(`M ${CX - hw} ${y} L ${CX + hw} ${y}`);
    }
    // Vertical reference bands
    for (const f of [0.22, 0.78]) {
        const x = VW * f;
        const hh = VH * 0.5 * (0.25 + (Math.abs(f - 0.5) / 0.5) * 0.6);
        p.push(`M ${x} ${CY - hh} L ${x} ${CY + hh}`);
    }
    return p;
}

/** Construction axes + measurement ticks. */
function axesPaths(): string[] {
    const p: string[] = [];
    const ext = SWEEP_R + TUBE_R + 55;
    // Cardinal axes
    p.push(`M ${CX - ext} ${CY} L ${CX + ext} ${CY}`);
    p.push(`M ${CX} ${CY - ext} L ${CX} ${CY + ext}`);
    // 45° diagonals
    const d = ext * 0.707;
    p.push(`M ${CX - d} ${CY - d} L ${CX + d} ${CY + d}`);
    p.push(`M ${CX + d} ${CY - d} L ${CX - d} ${CY + d}`);
    // Tick marks
    const tk = 5;
    for (let i = 1; i <= 4; i++) {
        const s = i * (SWEEP_R / 3);
        p.push(`M ${CX + s} ${CY - tk} L ${CX + s} ${CY + tk}`);
        p.push(`M ${CX - s} ${CY - tk} L ${CX - s} ${CY + tk}`);
        p.push(`M ${CX - tk} ${CY + s} L ${CX + tk} ${CY + s}`);
        p.push(`M ${CX - tk} ${CY - s} L ${CX + tk} ${CY - s}`);
    }
    return p;
}

/** Torus construction: profile circles, cross-sections, radials. */
function torusPaths() {
    const outline: string[] = [];
    const sections: string[] = [];
    const radials: string[] = [];

    // Three concentric profile circles (the "donut" blueprint)
    outline.push(arc(CX, CY, SWEEP_R)); // sweep path
    outline.push(arc(CX, CY, SWEEP_R + TUBE_R)); // outer edge
    outline.push(arc(CX, CY, SWEEP_R - TUBE_R)); // inner edge

    // Cross-section circles placed around the sweep
    for (let i = 0; i < N_SECTIONS; i++) {
        const a = (i / N_SECTIONS) * Math.PI * 2;
        sections.push(arc(CX + SWEEP_R * Math.cos(a), CY + SWEEP_R * Math.sin(a), TUBE_R));
    }

    // Radial guide lines from center through each section
    for (let i = 0; i < N_SECTIONS; i++) {
        const a = (i / N_SECTIONS) * Math.PI * 2;
        const r = SWEEP_R + TUBE_R + 18;
        radials.push(`M ${CX} ${CY} L ${CX + r * Math.cos(a)} ${CY + r * Math.sin(a)}`);
    }

    return { outline, sections, radials };
}

// Pre-compute — runs once at module level
const GRID = gridPaths();
const AXES = axesPaths();
const TORUS = torusPaths();

/* ─── Component ──────────────────────────────────────────── */

export default function Preloader({
    ready,
    onDismissStart,
}: {
    ready: boolean;
    onDismissStart?: () => void;
}) {
    const [minTimePassed, setMinTimePassed] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const overlayRef = useRef<HTMLDivElement>(null);
    const dismissFired = useRef(false);

    /* stagger reveal phases */
    const [showGrid, setShowGrid] = useState(false);
    const [showAxes, setShowAxes] = useState(false);
    const [showTorus, setShowTorus] = useState(false);
    const [showLabel, setShowLabel] = useState(false);

    useEffect(() => {
        const timers = [
            setTimeout(() => setShowGrid(true), GRID_DELAY),
            setTimeout(() => setShowAxes(true), AXES_DELAY),
            setTimeout(() => setShowTorus(true), TORUS_DELAY),
            setTimeout(() => setShowLabel(true), LABEL_DELAY),
        ];
        return () => timers.forEach(clearTimeout);
    }, []);

    useEffect(() => {
        const id = setTimeout(() => setMinTimePassed(true), MIN_DISPLAY_MS);
        return () => clearTimeout(id);
    }, []);

    const shouldHide = ready && minTimePassed;

    /* Lock scrollbar while preloader is on-screen */
    useEffect(() => {
        const el = document.documentElement;
        if (!shouldHide) {
            el.classList.add("preloader-active");
        } else {
            el.classList.remove("preloader-active");
        }
        return () => el.classList.remove("preloader-active");
    }, [shouldHide]);

    useEffect(() => {
        if (!shouldHide || dismissFired.current) return;
        dismissFired.current = true;
        onDismissStart?.();
    }, [shouldHide, onDismissStart]);

    /* unmount after radial wave + fade completes */
    useEffect(() => {
        if (!shouldHide) return;
        const id = setTimeout(() => setDismissed(true), 3200);
        return () => clearTimeout(id);
    }, [shouldHide]);

    if (dismissed) return null;

    return (
        <div
            ref={overlayRef}
            className={styles.preloader}
            data-hidden={shouldHide ? "1" : "0"}
            aria-hidden={shouldHide ? "true" : undefined}
        >
            {/* Blueprint construction SVG */}
            <div className={styles.blueprintWrap}>
                <svg
                    viewBox={`0 0 ${VW} ${VH}`}
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    className={styles.blueprint}
                >
                    {/* Layer 1 — Perspective corridor suggestion */}
                    <g
                        className={styles.bpLayer}
                        data-visible={showGrid ? "1" : "0"}
                        data-layer="grid"
                    >
                        {GRID.map((d, i) => (
                            <path key={i} d={d} stroke="currentColor" strokeWidth="0.5" />
                        ))}
                    </g>

                    {/* Layer 2 — Construction axes + ticks */}
                    <g
                        className={styles.bpLayer}
                        data-visible={showAxes ? "1" : "0"}
                        data-layer="axes"
                    >
                        {AXES.map((d, i) => (
                            <path
                                key={i}
                                d={d}
                                stroke="currentColor"
                                strokeWidth={i < 4 ? "0.6" : "0.35"}
                            />
                        ))}
                    </g>

                    {/* Layer 3 — Torus ring blueprint */}
                    <g
                        className={styles.bpLayer}
                        data-visible={showTorus ? "1" : "0"}
                        data-layer="torus"
                    >
                        {/* Dashed radial guide lines */}
                        {TORUS.radials.map((d, i) => (
                            <path
                                key={`r${i}`}
                                d={d}
                                stroke="currentColor"
                                strokeWidth="0.3"
                                strokeDasharray="3 2.5"
                                opacity="0.4"
                            />
                        ))}
                        {/* Three concentric profile circles — draw-in animated */}
                        {TORUS.outline.map((d, i) => (
                            <path
                                key={`o${i}`}
                                d={d}
                                stroke="currentColor"
                                strokeWidth={i === 0 ? "1.2" : "0.6"}
                                pathLength={1}
                                className={styles.bpDrawIn}
                            />
                        ))}
                        {/* Cross-section indicator circles — staggered draw-in */}
                        {TORUS.sections.map((d, i) => (
                            <path
                                key={`s${i}`}
                                d={d}
                                stroke="currentColor"
                                strokeWidth="0.5"
                                pathLength={1}
                                className={styles.bpDrawIn}
                                style={{ animationDelay: `${i * 50}ms` }}
                            />
                        ))}
                    </g>
                </svg>
            </div>

            {/* Brand mark */}
            <div className={styles.preloaderBrand} data-visible={showLabel ? "1" : "0"}>
                <span>PIERCER</span>
                <span className={styles.preloaderDot} aria-hidden="true" />
                <span>KZN</span>
            </div>

            {/* Tagline */}
            <div className={styles.preloaderTagline} data-visible={showLabel ? "1" : "0"}>
                Визуализируй &middot; Примерь &middot; Носи
            </div>

            {/* Bloom glow overlay — fires on dismiss */}
            <div className={styles.bloom} aria-hidden="true" />
        </div>
    );
}
