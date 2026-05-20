"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./page.module.css";
import WireframeRoom from "./WireframeRoom";
import Preloader from "./Preloader";
import HowItWorks from "./HowItWorks";
import ChooseIntro from "./ChooseIntro";
import Ch2GridOverlay from "./Ch2GridOverlay";
import Ch2ZoneMarker from "./Ch2ZoneMarker";
import Epilogue from "./Epilogue";
import { ChromeHeader } from "@/components/ChromeHeader";
import { SiteFooter } from "@/components/SiteFooter";
import { SITE } from "@/lib/site";
import { SCROLL_EVENT, scrollToSection } from "@/lib/scroll";

export default function NewDesignPage() {
    const heroRef = useRef<HTMLElement | null>(null);
    const stageRef = useRef<HTMLDivElement | null>(null);
    const mouseRef = useRef({ x: 0, y: 0 });
    const pointerActiveRef = useRef(true);
    const [sceneReady, setSceneReady] = useState(false);
    const [revealed, setRevealed] = useState(false);

    /* ── Multi-chapter scroll tracking ── */
    const chooseRef = useRef<HTMLDivElement | null>(null);
    const chapter1Ref = useRef<HTMLDivElement | null>(null);
    const ch2IntroRef = useRef<HTMLDivElement | null>(null);
    const chapter2Ref = useRef<HTMLDivElement | null>(null);
    const chapter3Ref = useRef<HTMLDivElement | null>(null);

    // scrollPhase: 0→1 as chapter 1 scrolls through viewport
    const scrollPhaseRef = useRef(0);
    // ch2Phase: 0→1 as chapter 2 enters viewport. Drives the Ch1→Ch2
    // multi-stage camera storyboard (pull-back → tilt-down → zoom on
    // floor → body materializes). Smooth, scroll-driven.
    const ch2PhaseRef = useRef(0);
    // ch2BodyPhase: 0→1 across Ch2's own viewport (top → bottom of
    // chapter2). Drives the 3D-canvas→2D-grid transition that plays
    // once the storyboard has settled into the floor close-up.
    const ch2BodyPhaseRef = useRef(0);
    // Which chapter is most visible (for dot nav highlight)
    // Stays as state because HowItWorks dot nav needs DOM re-renders.
    const [activeChapter, setActiveChapter] = useState(0);
    // Also keep a ref mirror for WireframeRoom's useFrame (avoids re-renders)
    const activeChapterRef = useRef(0);

    // Mobile menu toggle
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    // Interactive state lifted to page level so WireframeRoom can react
    const [activeJewelry, setActiveJewelry] = useState(0);
    const [activeArea, setActiveArea] = useState("ear_left");
    // Jewelry display name — kept for HowItWorks chapter title
    const [jewelryName, setJewelryName] = useState("Cross Earring");

    // Shared transition progress (0 = idle, peaks at 1, returns to 0)
    const transitionProgress = useRef(0);

    // Swap direction: 1 = forward (right→left), -1 = backward (left→right)
    // Used by GlassPiece for directional slide during jewelry transitions.
    const swapDirection = useRef(1);

    // Scroll velocity (normalized 0-1) for reactive effects
    const scrollVelocityRef = useRef(0);

    // Smooth scroll refs
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

            // scrollPhase ramps 0→1 across the full hero→Chapter-1
            // distance. With the ChooseIntro section inserted between
            // heroSpacer and Chapter 1, that distance is now *two*
            // viewports of scroll (hero spacer + ChooseIntro), so we
            // divide by 2*vh. sp=0: top of hero. sp=0.5: ChooseIntro
            // pinned (camera at Chapter-1 position). sp=1: Chapter 1
            // settled.
            const el1 = refs[0].current;
            if (el1) {
                const rect = el1.getBoundingClientRect();
                const raw = 1 - rect.top / (2 * vh);
                scrollPhaseRef.current = Math.max(0, Math.min(1, raw));
            }

            // ch2Phase ramps 0→1 as the user scrolls across the
            // Ch2-intro spacer + the Ch1→Ch2 boundary. With the new
            // Ch2Intro section inserted before chapter 2, the
            // storyboard now plays out over 2*vh of scroll instead
            // of 1*vh — each of the 4 stages gets ~50vh, much more
            // breathing room.
            //
            // ph=0 when ch2intro's top is at +1.0vh (still below the
            // viewport, end of Ch1). ph=1 when chapter2's top is at 0
            // (Ch2 fills viewport). The midpoint (ph=0.5) lands when
            // ch2intro is pinned in viewport.
            const intro = ch2IntroRef.current;
            if (intro) {
                const rectI = intro.getBoundingClientRect();
                // rectI.top goes from +vh (intro just entering) to
                // -vh (intro just left, ch2 fills viewport). Map that
                // to 0→1.
                const raw2 = 1 - (rectI.top + vh) / (2 * vh);
                ch2PhaseRef.current = Math.max(0, Math.min(1, raw2));
            }

            // ch2BodyPhase ramps 0→1 across Ch2's own viewport.
            // ch2.top = 0 (Ch2 just filled viewport) → 0.
            // ch2.top = -vh (user has scrolled all the way through
            // Ch2 to the start of Ch3) → 1. Drives the 3D-canvas →
            // 2D-grid transition once the storyboard has settled.
            const c2 = chapter2Ref.current;
            if (c2) {
                const rectC2 = c2.getBoundingClientRect();
                const rawB = -rectC2.top / vh;
                ch2BodyPhaseRef.current = Math.max(0, Math.min(1, rawB));
            }

            // Determine active chapter. Hero + ChooseIntro both stay
            // at ac=0 — the 3D scene transitions are driven smoothly
            // by scrollPhase across this range. ac flips to 1 when
            // user is mostly into Chapter 1.
            const scrollY = window.scrollY;
            if (scrollY < vh * 1.5) {
                if (activeChapterRef.current !== 0) {
                    activeChapterRef.current = 0;
                    setActiveChapter(0); // hero / ChooseIntro
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

    /* ── Lenis-style viscous smooth scroll ──
       Intercepts wheel events, accumulates into a virtual target,
       then exponentially decays toward it (frame-rate independent).
       Section snap after brief idle. Wheel-hijack disabled on touch
       devices — they get native scroll plus the existing swipe gestures. */
    useEffect(() => {
        // Touch device detection — skip the wheel-hijack loop entirely.
        // Touch users still get the chapter swipe gestures and native scroll.
        const isTouch =
            typeof window !== "undefined" &&
            ("ontouchstart" in window || navigator.maxTouchPoints > 0);

        const SCROLL_LAMBDA = 6; // exponential decay rate for normal scrolling
        const SNAP_LAMBDA = 12; // faster decay when snapping to section
        const WHEEL_DAMPING = 0.4;
        const SNAP_VELOCITY_THRESHOLD = 5;
        const SNAP_DELAY = 600; // ms idle before snap engages — longer = more natural momentum

        const getSectionTops = (): number[] => {
            // Use getBoundingClientRect + scrollY to get DOCUMENT-relative
            // section tops. `el.offsetTop` returns offset from the nearest
            // positioned ancestor, and .howItWorks is `position: relative`,
            // so offsetTop on chapter elements would be relative to that
            // wrapper (0, 100vh, 200vh) — wrong for document scroll math.
            // Using the document-relative top via getBoundingClientRect
            // ensures snap targets line up with actual scroll positions.
            //
            // Includes ChooseIntro so the user can rest on the
            // hero→Ch1 transition (where ВЫБЕРИ floats), and ends with
            // the document max-scroll so the Epilogue + footer can be
            // reached without being bounced back to Chapter 3.
            const tops: number[] = [0];
            [chooseRef, chapter1Ref, ch2IntroRef, chapter2Ref, chapter3Ref].forEach((ref) => {
                const el = ref.current;
                if (el) {
                    const rect = el.getBoundingClientRect();
                    tops.push(rect.top + window.scrollY);
                }
            });
            tops.push(getMaxScroll());
            return tops;
        };

        const getMaxScroll = () => document.documentElement.scrollHeight - window.innerHeight;

        // Sync from current position
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

        // Custom event handler for programmatic scroll (nav links, hero CTAs,
        // chapter CTAs). On non-touch, routes through targetScroll so the
        // smooth-scroll loop takes over. On touch, falls back to native
        // scrollIntoView so the OS-native scroll physics handle it.
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

        // On touch devices, skip the wheel-hijack loop and keyboard nav —
        // native scroll plus the chapter-level swipe gestures cover it.
        if (isTouch) {
            return () => {
                window.removeEventListener(SCROLL_EVENT, onScrollEvent);
            };
        }

        const tick = () => {
            const now = performance.now();
            const dt = Math.min((now - lastTime) / 1000, 0.05); // cap at 50ms
            lastTime = now;

            // External-scroll resync. If window.scrollY has moved outside our
            // wheel-hijack control (scrollbar drag, keyboard PgDn handled by
            // the browser, in-page anchor navigation, browser back/forward,
            // dev-tools scroll), it'll diverge from currentScroll by more
            // than a single frame's expected advance. When that happens, we
            // adopt the new scrollY as authoritative and re-zero our target
            // so the smooth-scroll loop continues from where the user is.
            // Without this resync the tick force-snaps scrollY back to
            // currentScroll every frame, breaking the scrollbar entirely
            // and pulling the user back to Chapter 1.
            const externalScrollY = window.scrollY;
            if (Math.abs(externalScrollY - currentScroll.current) > 4) {
                currentScroll.current = externalScrollY;
                targetScroll.current = externalScrollY;
                snappedTo = -1;
                idleStart = 0;
            }

            const diff = targetScroll.current - currentScroll.current;
            const velocity = Math.abs(diff);

            // Detect idle and apply delayed snap
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

            // Exponential decay — frame-rate independent, no stepping
            const lambda = snappedTo >= 0 ? SNAP_LAMBDA : SCROLL_LAMBDA;
            const t = 1 - Math.exp(-lambda * dt);
            currentScroll.current += diff * t;

            // Expose normalized scroll velocity (0-1, clamped)
            scrollVelocityRef.current = Math.min(1, velocity / 500);

            // Hard-snap when close enough
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

        // Keyboard navigation: PageDown/Up, Home/End, Arrow keys
        const onKeyNav = (e: KeyboardEvent) => {
            // Don't intercept if user is typing
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
                    // Find next section below current position
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
                    // Find previous section above current position
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

    /* ── Window-level mouse tracking ──
       Normalized to viewport (the fixed canvas always fills it).
       Works everywhere — hero, steps, future sections. */
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
        <div className={styles.siteShell}>
            {/* ── Floating chrome header ── */}
            <ChromeHeader className={styles.nav}>
                <Link href="/" className={styles.navBrand} aria-label="PiercerKZN">
                    <span>PIERCER</span>
                    <span className={styles.navBrandDot} aria-hidden="true" />
                    <span>KZN</span>
                </Link>
                <ul className={styles.navLinks} data-hero={activeChapter === 0 ? "1" : "0"}>
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
                <div className={styles.navActions}>
                    <button
                        type="button"
                        className={styles.navBurger}
                        aria-label={mobileMenuOpen ? "Закрыть меню" : "Открыть меню"}
                        aria-expanded={mobileMenuOpen ? "true" : "false"}
                        onClick={() => setMobileMenuOpen((v) => !v)}
                    >
                        <span
                            className={styles.navBurgerLine}
                            data-open={mobileMenuOpen ? "1" : "0"}
                        />
                        <span
                            className={styles.navBurgerLine}
                            data-open={mobileMenuOpen ? "1" : "0"}
                        />
                    </button>
                    <a
                        className={styles.navCta}
                        href={SITE.telegram}
                        target="_blank"
                        rel="noreferrer noopener"
                    >
                        <span className={styles.navCtaDot} aria-hidden="true" />
                        Записаться
                    </a>
                </div>
            </ChromeHeader>

            {/* Mobile overlay menu */}
            {mobileMenuOpen && (
                <div className={styles.mobileMenu} role="dialog" aria-label="Навигация">
                    <a
                        href="#showcase"
                        className={styles.mobileMenuLink}
                        onClick={(e) => {
                            e.preventDefault();
                            setMobileMenuOpen(false);
                            scrollToSection("showcase");
                        }}
                    >
                        Визуализатор
                    </a>
                    <a
                        href="#try-on"
                        className={styles.mobileMenuLink}
                        onClick={(e) => {
                            e.preventDefault();
                            setMobileMenuOpen(false);
                            scrollToSection("try-on");
                        }}
                    >
                        Каталог
                    </a>
                    <a
                        href="#reserve"
                        className={styles.mobileMenuLink}
                        onClick={(e) => {
                            e.preventDefault();
                            setMobileMenuOpen(false);
                            scrollToSection("reserve");
                        }}
                    >
                        Бронь
                    </a>
                </div>
            )}

            {/* ── Sticky 3D backdrop ── */}
            <div className={styles.stickyCanvas}>
                <section ref={heroRef} className={styles.hero} aria-label="PiercerKZN — hero">
                    {/* 3D canvas layer */}
                    <div
                        ref={stageRef}
                        className={styles.stage}
                        data-revealed={revealed ? "1" : "0"}
                    >
                        <WireframeRoom
                            scopeRef={heroRef}
                            fontUrl="/fonts/Montserrat-ExtraBold.ttf"
                            mouseRef={mouseRef}
                            pointerActiveRef={pointerActiveRef}
                            onReady={() => setSceneReady(true)}
                            revealed={revealed}
                            scrollPhase={scrollPhaseRef}
                            ch2Phase={ch2PhaseRef}
                            ch2BodyPhase={ch2BodyPhaseRef}
                            activeChapter={activeChapterRef}
                            activeJewelry={activeJewelry}
                            activeArea={activeArea}
                            transitionProgress={transitionProgress}
                            swapDirection={swapDirection}
                            scrollVelocity={scrollVelocityRef}
                        />
                        <div className={styles.vignette} />
                    </div>

                    {/* Preloader overlay */}
                    <Preloader ready={sceneReady} onDismissStart={handleDismissStart} />
                </section>
            </div>

            {/* 2D grid overlay — slides up from the bottom as the
                user scrolls into Ch2 proper, settling over the held
                3D floor close-up below. */}
            <Ch2GridOverlay ch2BodyPhase={ch2BodyPhaseRef} />
            {/* Zone marker — magenta dot snaps to a grid intersection
                for the active zone. Promotes the 2D grid from
                decoration to a coordinate system (idea 3). */}
            <Ch2ZoneMarker activeArea={activeArea} ch2BodyPhase={ch2BodyPhaseRef} />

            {/* ── Scrollable content layers ── */}
            {/* Spacer: first 100vh is "occupied" by the hero (which is fixed) */}
            <div className={styles.heroSpacer} />

            {/* Visually hidden h1 for SEO + screen readers */}
            <h1 className={styles.srOnly}>
                PiercerKZN — студия пирсинга в Казани с 3D‑примеркой украшений
            </h1>

            {/* ВЫБЕРИ intro — discrete section between hero and Chapter 1.
                Provides 100vh of scroll space for the camera/ring/rotation
                transition, plus a big text overlay that slides in/out. */}
            <ChooseIntro sectionRef={chooseRef} />

            {/* How It Works — 3 chapters + Ch2 intro spacer */}
            <HowItWorks
                chapter1Ref={chapter1Ref}
                ch2IntroRef={ch2IntroRef}
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

            {/* Epilogue — quiet afterimage between climax and footer */}
            <Epilogue />

            <SiteFooter
                classes={{
                    siteFooter: styles.siteFooter,
                    footerCols: styles.footerCols,
                    footerDesc: styles.footerDesc,
                    footerLinks: styles.footerLinks,
                    footerH: styles.footerH,
                    footerWordmark: styles.footerWordmark,
                    footerBase: styles.footerBase,
                }}
            />
        </div>
    );
}
