"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import styles from "./page.module.css";

import WireframeRoom from "./WireframeRoom";
import { ChromeHeader } from "@/components/ChromeHeader";

export default function NewDesignCopyPage() {
    const heroRef = useRef<HTMLElement | null>(null);
    const mouseRef = useRef({ x: 0, y: 0 });
    const [showScroll, setShowScroll] = useState(true);
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    const handlePointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    }, []);

    const handlePointerLeave = useCallback(() => {
        mouseRef.current.x = 0;
        mouseRef.current.y = 0;
    }, []);

    // Hide scroll indicator after scrolling
    useEffect(() => {
        const onScroll = () => {
            setShowScroll(window.scrollY < 100);
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    return (
        <section
            ref={heroRef}
            className={styles.hero}
            aria-label="PiercerKZN — hero"
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
        >
            {/* 3D canvas layer */}
            <div className={styles.stage}>
                <WireframeRoom
                    scopeRef={heroRef}
                    fontUrl="/fonts/Montserrat-ExtraBold.ttf"
                    mouseRef={mouseRef}
                />
                <div className={styles.vignette} />
            </div>

            {/* Hero content overlay */}
            <div className={styles.heroContent}>
                <motion.p
                    className={styles.heroLabel}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6, duration: 0.7, ease: "easeOut" }}
                >
                    Студия пирсинга в Казани
                </motion.p>

                <motion.h1
                    className={styles.heroHeadline}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.85, duration: 0.8, ease: "easeOut" }}
                >
                    <span className={styles.heroHeadlineWord}>Визуализируй.</span>{" "}
                    <span className={styles.heroHeadlineWord}>Примерь.</span>{" "}
                    <span className={styles.heroHeadlineAccent}>Носи.</span>
                </motion.h1>

                <motion.p
                    className={styles.heroSub}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.15, duration: 0.7, ease: "easeOut" }}
                >
                    Первая студия с 3D-визуализацией украшений — выберите пирсинг и&nbsp;примерьте
                    украшения на&nbsp;реалистичной модели ещё до&nbsp;визита
                </motion.p>

                <motion.div
                    className={styles.heroCtas}
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 1.4, duration: 0.7, ease: "easeOut" }}
                >
                    <a href="/visualizer" className={styles.ctaPrimary}>
                        <span className={styles.ctaDot} aria-hidden="true" />
                        Попробовать 3D
                    </a>
                    <a href="/booking" className={styles.ctaSecondary}>
                        Записаться
                    </a>
                </motion.div>
            </div>

            {/* Scroll indicator */}
            <AnimatePresence>
                {showScroll && (
                    <motion.div
                        className={styles.scrollIndicator}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ delay: 2.0, duration: 0.6 }}
                        aria-hidden="true"
                    >
                        <svg
                            width="20"
                            height="28"
                            viewBox="0 0 20 28"
                            fill="none"
                            className={styles.scrollChevron}
                        >
                            <rect
                                x="1"
                                y="1"
                                width="18"
                                height="26"
                                rx="9"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                opacity="0.4"
                            />
                            <circle
                                cx="10"
                                cy="9"
                                r="2.5"
                                fill="currentColor"
                                className={styles.scrollDot}
                            />
                        </svg>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Chrome header — floating pill */}
            <ChromeHeader className={styles.chromeNav}>
                <a href="/" className={styles.navBrand}>
                    <span>PIERCER</span>
                    <span className={styles.navBrandDot} aria-hidden="true" />
                    <span>KZN</span>
                </a>
                <ul className={styles.navLinks}>
                    <li>
                        <a href="/visualizer">Визуализатор</a>
                    </li>
                    <li>
                        <a href="/catalog">Каталог</a>
                    </li>
                    <li>
                        <a href="/booking">Запись</a>
                    </li>
                    <li>
                        <a href="/contact">Контакты</a>
                    </li>
                </ul>
                <div className={styles.navActions}>
                    {/* ThemeToggle removed */}
                    <a className={styles.navCta} href="/booking">
                        <span className={styles.navCtaDot} aria-hidden="true" />
                        Записаться
                    </a>
                    {/* Mobile hamburger */}
                    <button
                        type="button"
                        className={styles.hamburger}
                        onClick={() => setMobileMenuOpen((v) => !v)}
                        aria-label="Открыть меню"
                        {...(mobileMenuOpen ? { "aria-expanded": true } : {})}
                    >
                        <span className={styles.hamburgerBar} data-open={mobileMenuOpen} />
                        <span className={styles.hamburgerBar} data-open={mobileMenuOpen} />
                    </button>
                </div>
            </ChromeHeader>

            {/* Mobile menu overlay */}
            <AnimatePresence>
                {mobileMenuOpen && (
                    <motion.div
                        className={styles.mobileMenu}
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                    >
                        <nav className={styles.mobileMenuNav}>
                            <a href="/visualizer" onClick={() => setMobileMenuOpen(false)}>
                                Визуализатор
                            </a>
                            <a href="/catalog" onClick={() => setMobileMenuOpen(false)}>
                                Каталог
                            </a>
                            <a href="/booking" onClick={() => setMobileMenuOpen(false)}>
                                Запись
                            </a>
                            <a href="/contact" onClick={() => setMobileMenuOpen(false)}>
                                Контакты
                            </a>
                        </nav>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
}
