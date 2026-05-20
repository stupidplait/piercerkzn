"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import baseStyles from "../new-design/page.module.css";
import styles from "./page.module.css";
import WireframeRoom from "../new-design/WireframeRoom";
import Preloader from "../new-design/Preloader";
import HowItWorks from "./HowItWorks";
import PortalTransition from "./PortalTransition";
import { ChromeHeader } from "@/components/ChromeHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE } from "@/lib/site";
import { SCROLL_EVENT, scrollToSection } from "@/lib/scroll";

/**
 * Variant B — Cinematic Portal.
 *
 * Same scroll/3D plumbing as canonical, but:
 *  • Hero→Chapter 1 hand-off uses a portal-style radial reveal + warm
 *    light switch + particle dust overlay (PortalTransition.tsx).
 *  • Chapter 1 spans ~250vh and is structured as three pinned acts
 *    (Знакомство → Коллекция → Деталь).
 *  • Top + bottom letterbox bars frame the 3D scene like a film still.
 *
 * Snap logic reads each act's offset so the smooth-scroll system can
 * snap to act boundaries within Chapter 1.
 */
export default function NewDesignCinematicPage() {
    const heroRef = useRef<HTMLElement | null>(null);
    const mouseRef = useRef({ x: 0, y: 0 });
    const pointerActiveRef = useRef(true);
    const [sceneReady, setSceneReady] = useState(false);
    const [revealed, setRevealed] = useState(false);

    const chapter1Ref = useRef<HTMLDivElement | null>(null);
    const chapter2Ref = useRef<HTMLDivElement | null>(null);
    const chapter3Ref = useRef<HTMLDivElement | null>(null);

    const scrollPhaseRef = useRef(0);
    const [activeChapter, setActiveChapter] = useState(0);
    const activeChapterRef = useRef(0);

    const [activeJewelry, setActiveJewelry] = useState(0);
    const [activeArea, setActiveArea] = useState("ear_left");
    const [, setJewelryName] = useState("Крест-серьга");

    const transitionProgress = useRef(0);
    const swapDirection = useRef(1);
    const scrollVelocityRef = useRef(0);

    const targetScroll = useRef(0);
    const currentScroll = useRef(0);
    const smoothRafId = useRef<number | undefined>(undefined);

    useEffect(() => {
        const refs = [chapter1Ref, chapter2Ref, chapter3Ref];
        let rafId: number;
        let rafScheduled = false;

        const readLayout = () => {
            rafScheduled = false;
            const vh = window.innerHeight;

            const el1 = refs[0].current;
            if (el1) {
                const rect = el1.getBoundingClientRect();
                // Phase only across the FIRST viewport of Chapter 1 — past that
                // we're in Act 1 and the wordmark should already be gone.
                const raw = 1 - rect.top / vh;
                scrollPhaseRef.current = Math.max(0, Math.min(1, raw));
            }

            const scrollY = window.scrollY;
            if (scrollY < vh * 0.5) {
                if (activeChapterRef.current !== 0) {
                    activeChapterRef.current = 0;
                    setActiveChapter(0);
                }
            } else {
                let best = 0;
                let bestDist = Infinity;
                refs.forEach((ref, i) => {
                    const el = ref.current;
                    if (!el) return;
                    const rect = el.getBoundingClientRect();
                    const center = rect.top + rect.height / 2;
                    const dist = Math.abs(center - vh / 2);
                    if (dist < bestDist) {
                        bestDist = dist;
                        best = i + 1;
                    }
                });
                if (activeChapterRef.current !== best) {
                    activeChapterRef.current = best;
                    setActiveChapter(best);
                }
            }
        };

        const onScroll = () => {
            if (!rafScheduled) {
                rafScheduled = true;
                rafId = requestAnimationFrame(readLayout);
            }
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        readLayout();
        return () => {
            window.removeEventListener("scroll", onScroll);
            cancelAnimationFrame(rafId);
        };
    }, []);

    useEffect(() => {
        const isTouch =
            typeof window !== "undefined" &&
            ("ontouchstart" in window || navigator.maxTouchPoints > 0);

        const SCROLL_LAMBDA = 6;
        const SNAP_LAMBDA = 12;
        const WHEEL_DAMPING = 0.4;
        const SNAP_VELOCITY_THRESHOLD = 5;
        const SNAP_DELAY = 600;

        // Includes the three internal Chapter 1 act tops in addition to
        // the chapter tops, so the snap system rests on each act boundary.
        const getSectionTops = (): number[] => {
            const tops: number[] = [0];
            const ch1 = chapter1Ref.current;
            if (ch1) {
                tops.push(ch1.offsetTop);
                ["cine-act-meet", "cine-act-collection", "cine-act-detail"].forEach((id) => {
                    const act = document.getElementById(id);
                    if (act) {
                        // act.offsetTop is relative to its offsetParent;
                        // we want absolute page offset.
                        const rect = act.getBoundingClientRect();
                        tops.push(rect.top + window.scrollY);
                    }
                });
            }
            const ch2 = chapter2Ref.current;
            if (ch2) tops.push(ch2.offsetTop);
            const ch3 = chapter3Ref.current;
            if (ch3) tops.push(ch3.offsetTop);
            return tops;
        };

        const getMaxScroll = () => document.documentElement.scrollHeight - window.innerHeight;

        targetScroll.current = window.scrollY;
        currentScroll.current = window.scrollY;
        let lastTime = performance.now();

        let idleStart = 0;
        let snappedTo = -1;

        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            targetScroll.current += e.deltaY * WHEEL_DAMPING;
            targetScroll.current = Math.max(0, Math.min(targetScroll.current, getMaxScroll()));
            idleStart = 0;
            snappedTo = -1;
        };

        const onScrollEvent = (ev: Event) => {
            const detail = (ev as CustomEvent<{ id?: string }>).detail;
            const id = detail?.id;
            if (!id) return;
            const el = document.getElementById(id);
            if (!el) return;
            ev.preventDefault();
            if (isTouch) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                return;
            }
            const max = getMaxScroll();
            const target = Math.max(0, Math.min(el.offsetTop, max));
            targetScroll.current = target;
            snappedTo = target;
            idleStart = 0;
        };
        window.addEventListener(SCROLL_EVENT, onScrollEvent);

        if (isTouch) {
            return () => {
                window.removeEventListener(SCROLL_EVENT, onScrollEvent);
            };
        }

        const tick = () => {
            const now = performance.now();
            const dt = Math.min((now - lastTime) / 1000, 0.05);
            lastTime = now;

            const diff = targetScroll.current - currentScroll.current;
            const velocity = Math.abs(diff);

            if (velocity < SNAP_VELOCITY_THRESHOLD) {
                if (idleStart === 0) {
                    idleStart = now;
                } else if (now - idleStart > SNAP_DELAY && snappedTo < 0) {
                    const tops = getSectionTops();
                    let nearest = 0;
                    let nearestDist = Infinity;
                    tops.forEach((top) => {
                        const d = Math.abs(targetScroll.current - top);
                        if (d < nearestDist) {
                            nearestDist = d;
                            nearest = top;
                        }
                    });
                    snappedTo = nearest;
                    targetScroll.current = nearest;
                }
            } else {
                idleStart = 0;
                snappedTo = -1;
            }

            const lambda = snappedTo >= 0 ? SNAP_LAMBDA : SCROLL_LAMBDA;
            const t = 1 - Math.exp(-lambda * dt);
            currentScroll.current += diff * t;

            scrollVelocityRef.current = Math.min(1, velocity / 500);

            if (Math.abs(targetScroll.current - currentScroll.current) < 0.5) {
                currentScroll.current = targetScroll.current;
            }

            if (Math.abs(currentScroll.current - window.scrollY) > 0.5) {
                window.scrollTo(0, currentScroll.current);
            }

            smoothRafId.current = requestAnimationFrame(tick);
        };

        smoothRafId.current = requestAnimationFrame(tick);
        window.addEventListener("wheel", onWheel, { passive: false });

        const onKeyNav = (e: KeyboardEvent) => {
            if (
                (e.target as HTMLElement)?.tagName === "INPUT" ||
                (e.target as HTMLElement)?.tagName === "TEXTAREA"
            )
                return;

            const tops = getSectionTops();
            const current = targetScroll.current;
            const max = getMaxScroll();

            switch (e.key) {
                case "PageDown":
                case "ArrowDown": {
                    e.preventDefault();
                    const next = tops.find((t) => t > current + 10);
                    if (next !== undefined) {
                        targetScroll.current = next;
                        snappedTo = next;
                        idleStart = 0;
                    }
                    break;
                }
                case "PageUp":
                case "ArrowUp": {
                    e.preventDefault();
                    const prev = [...tops].reverse().find((t) => t < current - 10);
                    if (prev !== undefined) {
                        targetScroll.current = prev;
                        snappedTo = prev;
                        idleStart = 0;
                    }
                    break;
                }
                case "Home": {
                    e.preventDefault();
                    targetScroll.current = 0;
                    snappedTo = 0;
                    idleStart = 0;
                    break;
                }
                case "End": {
                    e.preventDefault();
                    targetScroll.current = max;
                    snappedTo = max;
                    idleStart = 0;
                    break;
                }
            }
        };
        window.addEventListener("keydown", onKeyNav);

        return () => {
            window.removeEventListener("wheel", onWheel);
            window.removeEventListener("keydown", onKeyNav);
            window.removeEventListener(SCROLL_EVENT, onScrollEvent);
            if (smoothRafId.current) cancelAnimationFrame(smoothRafId.current);
        };
    }, []);

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

    const handleDismissStart = useCallback(() => {
        setRevealed(true);
    }, []);

    return (
        <div className={`${baseStyles.siteShell} ${styles.cineShell}`}>
            <ChromeHeader className={baseStyles.nav}>
                <Link href="/" className={baseStyles.navBrand} aria-label="PiercerKZN">
                    <span>PIERCER</span>
                    <span className={baseStyles.navBrandDot} aria-hidden="true" />
                    <span>KZN</span>
                </Link>
                <ul className={baseStyles.navLinks} data-hero={activeChapter === 0 ? "1" : "0"}>
                    <li>
                        <a
                            href="#showcase"
                            onClick={(e) => {
                                e.preventDefault();
                                scrollToSection("showcase");
                            }}
                        >
                            Визуализатор
                        </a>
                    </li>
                    <li>
                        <a
                            href="#try-on"
                            onClick={(e) => {
                                e.preventDefault();
                                scrollToSection("try-on");
                            }}
                        >
                            Каталог
                        </a>
                    </li>
                    <li>
                        <a
                            href="#reserve"
                            onClick={(e) => {
                                e.preventDefault();
                                scrollToSection("reserve");
                            }}
                        >
                            Бронь
                        </a>
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

            <div className={baseStyles.stickyCanvas}>
                <section ref={heroRef} className={baseStyles.hero} aria-label="PiercerKZN — hero">
                    <div className={baseStyles.stage} data-revealed={revealed ? "1" : "0"}>
                        <WireframeRoom
                            scopeRef={heroRef}
                            fontUrl="/fonts/Montserrat-ExtraBold.ttf"
                            mouseRef={mouseRef}
                            pointerActiveRef={pointerActiveRef}
                            onReady={() => setSceneReady(true)}
                            revealed={revealed}
                            scrollPhase={scrollPhaseRef}
                            activeChapter={activeChapterRef}
                            activeJewelry={activeJewelry}
                            transitionProgress={transitionProgress}
                            swapDirection={swapDirection}
                            scrollVelocity={scrollVelocityRef}
                        />
                        <div className={baseStyles.vignette} />
                    </div>

                    {/* Cinematic transition overlay — radial portal + warm
                        light + particle dust, all driven by scrollPhase. */}
                    <PortalTransition scrollPhase={scrollPhaseRef} />

                    <Preloader ready={sceneReady} onDismissStart={handleDismissStart} />
                </section>
            </div>

            <div className={baseStyles.heroSpacer} />

            <HowItWorks
                chapter1Ref={chapter1Ref}
                chapter2Ref={chapter2Ref}
                chapter3Ref={chapter3Ref}
                activeJewelry={activeJewelry}
                onJewelryChange={setActiveJewelry}
                onNameChange={setJewelryName}
                activeArea={activeArea}
                onAreaChange={setActiveArea}
                transitionProgress={transitionProgress}
                swapDirection={swapDirection}
            />

            <SiteFooter
                classes={{
                    siteFooter: baseStyles.siteFooter,
                    footerCols: baseStyles.footerCols,
                    footerDesc: baseStyles.footerDesc,
                    footerLinks: baseStyles.footerLinks,
                    footerH: baseStyles.footerH,
                    footerWordmark: baseStyles.footerWordmark,
                    footerBase: baseStyles.footerBase,
                }}
            />
        </div>
    );
}
