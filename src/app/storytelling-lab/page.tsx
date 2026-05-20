"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import baseStyles from "../new-design/page.module.css";
import styles from "./page.module.css";
import WireframeRoom from "../new-design/WireframeRoom";
import { JEWELRY_ITEMS } from "../new-design/JewelryShowcase";
import { useJewelrySwap } from "../new-design/hooks/useJewelrySwap";
import { ChromeHeader } from "@/components/ChromeHeader";
import { SITE } from "@/lib/site";

import GridFloor from "./layers/GridFloor";
import BodyAreaIndicator from "./layers/BodyAreaIndicator";
import MaterialSwatches from "./layers/MaterialSwatches";
import HangingTag from "./layers/HangingTag";
import LightRig from "./layers/LightRig";
import PatronQuotes from "./layers/PatronQuotes";
import ProvenanceCard from "./layers/ProvenanceCard";
import BlueprintSketches from "./layers/BlueprintSketches";
import StudioMap from "./layers/StudioMap";

type LayerId =
    | "gridFloor"
    | "bodyArea"
    | "swatches"
    | "tag"
    | "lightRig"
    | "quotes"
    | "provenance"
    | "blueprint"
    | "studio";

// Podium is now baked into the canonical 3D scene (WireframeRoom),
// so it's no longer a toggleable lab layer — these 9 are the remaining
// fill candidates that overlay on top of the 3D podium baseline.
const LAYERS: { id: LayerId; index: string; label: string }[] = [
    { id: "gridFloor", index: "01", label: "Пол / сетка" },
    { id: "bodyArea", index: "02", label: "Зона тела" },
    { id: "swatches", index: "03", label: "Материалы" },
    { id: "tag", index: "04", label: "Бирка" },
    { id: "lightRig", index: "05", label: "Свет" },
    { id: "quotes", index: "06", label: "Отзывы" },
    { id: "provenance", index: "07", label: "Сертификат" },
    { id: "blueprint", index: "08", label: "Чертёж" },
    { id: "studio", index: "09", label: "План студии" },
];

const PRESETS: { id: string; label: string; layers: LayerId[] }[] = [
    { id: "minimal", label: "Минимум", layers: ["gridFloor"] },
    { id: "studio", label: "Студия", layers: ["gridFloor", "bodyArea", "lightRig", "provenance"] },
    { id: "all", label: "Полный", layers: LAYERS.map((l) => l.id) },
    { id: "none", label: "Чистый", layers: [] },
];

/**
 * Storytelling lab — toggle 10 visual fill layers on/off independently
 * to find the right composition for Chapter 1. The 3D scene + Rolodex
 * picker are the canonical baseline; layers are pure visual overlays.
 */
export default function StorytellingLabPage() {
    const heroRef = useRef<HTMLElement | null>(null);
    const mouseRef = useRef({ x: 0, y: 0 });
    const pointerActiveRef = useRef(true);

    const scrollPhaseRef = useRef(1);
    const activeChapterRef = useRef(1);
    const scrollVelocityRef = useRef(0);

    const [activeJewelry, setActiveJewelry] = useState(0);
    const transitionProgress = useRef(0);
    const swapDirection = useRef(1);
    const [, setSceneReady] = useState(false);

    const [enabled, setEnabled] = useState<Set<LayerId>>(
        new Set<LayerId>(["gridFloor", "bodyArea"])
    );

    const { triggerSwap, goToIndex } = useJewelrySwap({
        activeJewelry,
        onJewelryChange: setActiveJewelry,
        transitionProgress,
        swapDirection,
    });

    // Direction tracking for consistent piece swap animation
    const prevActive = useRef(activeJewelry);
    const [direction, setDirection] = useState<1 | -1>(1);
    useEffect(() => {
        if (prevActive.current === activeJewelry) return;
        const total = JEWELRY_ITEMS.length;
        const forward = (activeJewelry - prevActive.current + total) % total;
        const backward = (prevActive.current - activeJewelry + total) % total;
        setDirection(forward <= backward ? 1 : -1);
        prevActive.current = activeJewelry;
    }, [activeJewelry]);

    // Wheel scroll on the inline Rolodex strip — same throttle pattern
    // as canonical so the lab feels identical when evaluating layers.
    const labRolodexRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const el = labRolodexRef.current;
        if (!el) return;
        let lockUntil = 0;
        const onWheel = (e: WheelEvent) => {
            // Consume both browser scroll and the window-level smooth-scroll
            // listener so the page doesn't scroll while the cursor is over
            // the rolodex strip.
            e.preventDefault();
            e.stopPropagation();
            const now = Date.now();
            if (now < lockUntil) return;
            if (Math.abs(e.deltaY) < 4) return;
            lockUntil = now + 350;
            triggerSwap(e.deltaY > 0 ? 1 : -1);
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [triggerSwap]);

    useEffect(() => {
        const onMove = (e: PointerEvent) => {
            pointerActiveRef.current = true;
            const w = window.innerWidth;
            const h = window.innerHeight;
            mouseRef.current.x = (e.clientX / w) * 2 - 1;
            mouseRef.current.y = -((e.clientY / h) * 2 - 1);
        };
        const onLeave = () => {
            pointerActiveRef.current = false;
        };
        window.addEventListener("pointermove", onMove, { passive: true });
        document.addEventListener("pointerleave", onLeave);
        return () => {
            window.removeEventListener("pointermove", onMove);
            document.removeEventListener("pointerleave", onLeave);
        };
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement)?.tagName === "INPUT") return;
            if (e.key === "ArrowLeft") triggerSwap(-1);
            if (e.key === "ArrowRight") triggerSwap(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [triggerSwap]);

    const toggle = useCallback((id: LayerId) => {
        setEnabled((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    const applyPreset = useCallback((layerIds: LayerId[]) => {
        setEnabled(new Set(layerIds));
    }, []);

    const total = JEWELRY_ITEMS.length;
    const prevIdx = (activeJewelry - 1 + total) % total;
    const nextIdx = (activeJewelry + 1) % total;
    const current = JEWELRY_ITEMS[activeJewelry];

    return (
        <div className={baseStyles.siteShell}>
            <ChromeHeader className={baseStyles.nav}>
                <Link href="/" className={baseStyles.navBrand} aria-label="PiercerKZN">
                    <span>PIERCER</span>
                    <span className={baseStyles.navBrandDot} aria-hidden="true" />
                    <span>KZN</span>
                </Link>
                <ul className={baseStyles.navLinks} data-hero="0">
                    <li>
                        <Link href="/">На главную</Link>
                    </li>
                    <li>
                        <Link href="/carousel-lab">Карусель</Link>
                    </li>
                </ul>
                <div className={baseStyles.navActions}>
                    <a
                        className={baseStyles.navCta}
                        href={SITE.telegram}
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        <span className={baseStyles.navCtaDot} aria-hidden="true" />
                        Записаться
                    </a>
                </div>
            </ChromeHeader>

            {/* Layer toggle toolbar */}
            <div className={styles.labToolbar}>
                <div className={styles.labToolbarKicker}>
                    <span className={styles.labToolbarTag}>LAB</span>
                    <span>Сторителлинг — 10 слоёв</span>
                </div>

                <div className={styles.labPresets}>
                    {PRESETS.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            className={styles.labPresetBtn}
                            onClick={() => applyPreset(p.layers)}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                <div className={styles.labToggleGrid}>
                    {LAYERS.map((l) => (
                        <button
                            key={l.id}
                            type="button"
                            className={styles.labToggleBtn}
                            data-active={enabled.has(l.id)}
                            onClick={() => toggle(l.id)}
                            aria-pressed={enabled.has(l.id)}
                        >
                            <span className={styles.labToggleIdx}>{l.index}</span>
                            <span className={styles.labToggleLabel}>{l.label}</span>
                            <span className={styles.labToggleSwitch} aria-hidden="true" />
                        </button>
                    ))}
                </div>
            </div>

            {/* Sticky 3D backdrop, locked to Chapter 1 mode */}
            <div className={baseStyles.stickyCanvas}>
                <section ref={heroRef} className={baseStyles.hero} aria-label="Storytelling lab">
                    {/* Background-layer overlays (z=1) — render BEFORE the 3D
                        canvas wrapper so they sit behind the piece */}
                    {enabled.has("blueprint") && (
                        <BlueprintSketches activeJewelry={activeJewelry} items={JEWELRY_ITEMS} />
                    )}
                    {enabled.has("gridFloor") && <GridFloor />}
                    {enabled.has("lightRig") && <LightRig />}

                    <div className={baseStyles.stage} data-revealed="1">
                        <WireframeRoom
                            scopeRef={heroRef}
                            fontUrl="/fonts/Montserrat-ExtraBold.ttf"
                            mouseRef={mouseRef}
                            pointerActiveRef={pointerActiveRef}
                            onReady={() => setSceneReady(true)}
                            revealed={true}
                            scrollPhase={scrollPhaseRef}
                            activeChapter={activeChapterRef}
                            activeJewelry={activeJewelry}
                            transitionProgress={transitionProgress}
                            swapDirection={swapDirection}
                            scrollVelocity={scrollVelocityRef}
                        />
                        <div className={baseStyles.vignette} />
                    </div>

                    {/* Mid-layer overlays (z=2-3) */}
                    {enabled.has("quotes") && <PatronQuotes />}
                    {enabled.has("swatches") && (
                        <MaterialSwatches activeJewelry={activeJewelry} items={JEWELRY_ITEMS} />
                    )}

                    {/* Foreground overlays (z=4) */}
                    {enabled.has("studio") && <StudioMap />}
                    {enabled.has("bodyArea") && (
                        <BodyAreaIndicator activeJewelry={activeJewelry} items={JEWELRY_ITEMS} />
                    )}
                    {enabled.has("tag") && (
                        <HangingTag activeJewelry={activeJewelry} items={JEWELRY_ITEMS} />
                    )}
                    {enabled.has("provenance") && (
                        <ProvenanceCard activeJewelry={activeJewelry} items={JEWELRY_ITEMS} />
                    )}

                    {/* Chapter card */}
                    <div className={styles.labChapterCard} aria-hidden="true">
                        <span className={styles.labChapterCardKicker}>ГЛАВА 01</span>
                        <span className={styles.labChapterCardRule} />
                        <span className={styles.labChapterCardTitle}>ВЫБЕРИ</span>
                    </div>

                    {/* Rolodex picker — same as canonical so layers integrate
                        against the production look */}
                    <div
                        ref={labRolodexRef}
                        className={styles.labRolodex}
                        aria-label="Список украшений"
                    >
                        <div className={styles.labRolodexRail}>
                            {JEWELRY_ITEMS.map((item, i) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={styles.labRolodexRailDot}
                                    data-active={i === activeJewelry ? "true" : "false"}
                                    onClick={() => goToIndex(i)}
                                    aria-label={item.name}
                                />
                            ))}
                        </div>

                        <div className={styles.labRolodexWindow}>
                            <AnimatePresence initial={false} mode="popLayout" custom={direction}>
                                <motion.button
                                    key={`prev-${prevIdx}`}
                                    type="button"
                                    className={styles.labRolodexHalo}
                                    onClick={() => triggerSwap(-1)}
                                    custom={direction}
                                    variants={haloVariants}
                                    initial="enter"
                                    animate="rest"
                                    exit="exit"
                                    transition={SLIDE_TRANSITION}
                                >
                                    <span className={styles.labRolodexHaloNum}>
                                        {String(prevIdx + 1).padStart(2, "0")}
                                    </span>
                                    <span className={styles.labRolodexHaloName}>
                                        {JEWELRY_ITEMS[prevIdx].name}
                                    </span>
                                </motion.button>

                                <motion.div
                                    key={`active-${activeJewelry}`}
                                    className={styles.labRolodexActive}
                                    custom={direction}
                                    variants={activeVariants}
                                    initial="enter"
                                    animate="rest"
                                    exit="exit"
                                    transition={SLIDE_TRANSITION}
                                >
                                    <span className={styles.labRolodexActiveNum}>
                                        {String(activeJewelry + 1).padStart(2, "0")} /{" "}
                                        {String(total).padStart(2, "0")}
                                    </span>
                                    <span className={styles.labRolodexActiveName}>
                                        {current.name}
                                    </span>
                                </motion.div>

                                <motion.button
                                    key={`next-${nextIdx}`}
                                    type="button"
                                    className={styles.labRolodexHalo}
                                    onClick={() => triggerSwap(1)}
                                    custom={direction}
                                    variants={haloVariants}
                                    initial="enter"
                                    animate="rest"
                                    exit="exit"
                                    transition={SLIDE_TRANSITION}
                                >
                                    <span className={styles.labRolodexHaloNum}>
                                        {String(nextIdx + 1).padStart(2, "0")}
                                    </span>
                                    <span className={styles.labRolodexHaloName}>
                                        {JEWELRY_ITEMS[nextIdx].name}
                                    </span>
                                </motion.button>
                            </AnimatePresence>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}

const SLIDE_DISTANCE = 28;
const SLIDE_TRANSITION = {
    duration: 0.5,
    ease: [0.22, 0.9, 0.32, 1] as [number, number, number, number],
};
const activeVariants = {
    enter: (dir: 1 | -1) => ({ opacity: 0, y: dir * SLIDE_DISTANCE, filter: "blur(6px)" }),
    rest: { opacity: 1, y: 0, filter: "blur(0px)" },
    exit: (dir: 1 | -1) => ({ opacity: 0, y: dir * -SLIDE_DISTANCE, filter: "blur(6px)" }),
};
const haloVariants = {
    enter: (dir: 1 | -1) => ({ opacity: 0, y: dir * SLIDE_DISTANCE * 0.7 }),
    rest: { opacity: 1, y: 0 },
    exit: (dir: 1 | -1) => ({ opacity: 0, y: dir * -SLIDE_DISTANCE * 0.7 }),
};
