"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import baseStyles from "../new-design/page.module.css";
import styles from "./page.module.css";
import WireframeRoom from "../new-design/WireframeRoom";
import { JEWELRY_ITEMS } from "../new-design/JewelryShowcase";
import { useJewelrySwap } from "../new-design/hooks/useJewelrySwap";
import { ChromeHeader } from "@/components/ChromeHeader";
import { SITE } from "@/lib/site";

import TabStrip from "./mechanics/TabStrip";
import PressurePlates from "./mechanics/PressurePlates";
import Turntable from "./mechanics/Turntable";
import Rolodex from "./mechanics/Rolodex";
import Coverflow from "./mechanics/Coverflow";
import MagnifierGrid from "./mechanics/MagnifierGrid";
import FilterChips from "./mechanics/FilterChips";
import HoldRotate from "./mechanics/HoldRotate";

type Mechanic =
    | "tabs"
    | "plates"
    | "turntable"
    | "rolodex"
    | "coverflow"
    | "grid"
    | "filter"
    | "hold";

const MECHANICS: { id: Mechanic; label: string; index: string }[] = [
    { id: "tabs", index: "01", label: "Полоска" },
    { id: "plates", index: "02", label: "Плитки" },
    { id: "turntable", index: "03", label: "Карусель" },
    { id: "rolodex", index: "04", label: "Картотека" },
    { id: "coverflow", index: "05", label: "Силуэты" },
    { id: "grid", index: "06", label: "Сетка" },
    { id: "filter", index: "07", label: "Фильтр" },
    { id: "hold", index: "08", label: "Удержание" },
];

/**
 * Carousel lab — single page that flips between 8 picker mechanics for
 * Chapter 1, sharing one 3D scene and one active-jewelry state. The 3D
 * scene is locked into "Chapter 1 mode" (scrollPhase=1, activeChapter=1)
 * so the wordmark is gone and the ring is at full presentation size.
 *
 * Comparison only — picking a winner here will inform the canonical
 * Chapter 1 redesign.
 */
export default function CarouselLabPage() {
    const heroRef = useRef<HTMLElement | null>(null);
    const mouseRef = useRef({ x: 0, y: 0 });
    const pointerActiveRef = useRef(true);
    const stageRef = useRef<HTMLDivElement | null>(null);

    // Lock the 3D scene into Chapter 1 mode — no scroll-driven phases here.
    const scrollPhaseRef = useRef(1);
    const activeChapterRef = useRef(1);
    const scrollVelocityRef = useRef(0);

    const [activeJewelry, setActiveJewelry] = useState(0);
    const transitionProgress = useRef(0);
    const swapDirection = useRef(1);
    const [sceneReady, setSceneReady] = useState(false);

    const [mechanic, setMechanic] = useState<Mechanic>("tabs");

    const { triggerSwap, goToIndex } = useJewelrySwap({
        activeJewelry,
        onJewelryChange: setActiveJewelry,
        transitionProgress,
        swapDirection,
    });

    // Window-level mouse tracking (matches canonical) — drives the
    // proximity bloom + parallax effects in the 3D scene.
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

    // Keyboard nav — left/right step pieces, applies in any mechanic.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (
                (e.target as HTMLElement)?.tagName === "INPUT" ||
                (e.target as HTMLElement)?.tagName === "TEXTAREA"
            )
                return;
            if (e.key === "ArrowLeft") triggerSwap(-1);
            if (e.key === "ArrowRight") triggerSwap(1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [triggerSwap]);

    const current = JEWELRY_ITEMS[activeJewelry];

    const mechanicProps = useMemo(
        () => ({
            activeJewelry,
            items: JEWELRY_ITEMS,
            triggerSwap,
            goToIndex,
            chapterRef: stageRef,
        }),
        [activeJewelry, triggerSwap, goToIndex]
    );

    const renderMechanic = useCallback(() => {
        switch (mechanic) {
            case "tabs":
                return <TabStrip {...mechanicProps} />;
            case "plates":
                return <PressurePlates {...mechanicProps} />;
            case "turntable":
                return <Turntable {...mechanicProps} />;
            case "rolodex":
                return <Rolodex {...mechanicProps} />;
            case "coverflow":
                return <Coverflow {...mechanicProps} />;
            case "grid":
                return <MagnifierGrid {...mechanicProps} />;
            case "filter":
                return <FilterChips {...mechanicProps} />;
            case "hold":
                return <HoldRotate {...mechanicProps} />;
        }
    }, [mechanic, mechanicProps]);

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

            {/* ── Mechanic picker toolbar ── */}
            <div className={styles.labToolbar}>
                <div className={styles.labToolbarKicker}>
                    <span className={styles.labToolbarTag}>LAB</span>
                    <span>Карусель — 8 механик</span>
                </div>
                <div className={styles.labToolbarPicker} role="tablist">
                    {MECHANICS.map((m) => (
                        <button
                            key={m.id}
                            type="button"
                            role="tab"
                            aria-selected={mechanic === m.id}
                            data-active={mechanic === m.id ? "true" : "false"}
                            className={styles.labToolbarBtn}
                            onClick={() => setMechanic(m.id)}
                        >
                            <span className={styles.labToolbarBtnIdx}>{m.index}</span>
                            <span className={styles.labToolbarBtnLabel}>{m.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* ── Sticky 3D backdrop, locked to Chapter 1 mode ── */}
            <div className={baseStyles.stickyCanvas}>
                <section ref={heroRef} className={baseStyles.hero} aria-label="Carousel lab">
                    <div ref={stageRef} className={baseStyles.stage} data-revealed="1">
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

                    {/* Chapter card — persistent label */}
                    <div className={styles.labChapterCard} aria-hidden="true">
                        <span className={styles.labChapterCardKicker}>ГЛАВА 01</span>
                        <span className={styles.labChapterCardRule} />
                        <span className={styles.labChapterCardTitle}>ВЫБЕРИ</span>
                    </div>

                    {/* Active mechanic UI overlay */}
                    <div
                        className={styles.labMechanicLayer}
                        data-mechanic={mechanic}
                        data-scene-ready={sceneReady ? "1" : "0"}
                    >
                        {renderMechanic()}
                    </div>

                    {/* Shared spec block — same for every mechanic */}
                    <div className={styles.labSpec} key={current.id}>
                        <span className={styles.labSpecName}>{current.name}</span>
                        <span className={styles.labSpecMeta}>
                            {current.material} · {current.gauge} · {current.style}
                        </span>
                        <span className={styles.labSpecPrice}>{current.price}</span>
                    </div>
                </section>
            </div>
        </div>
    );
}
