"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

import styles from "./about.module.css";

interface PortfolioImage {
    id: string;
    imageUrl: string;
    thumbnailUrl: string | null;
    description: string | null;
}

interface PortfolioGalleryProps {
    images: PortfolioImage[];
}

export function PortfolioGallery({ images }: PortfolioGalleryProps) {
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

    const handleClose = useCallback(() => setSelectedIndex(null), []);

    const handlePrev = useCallback(() => {
        setSelectedIndex((prev) =>
            prev !== null ? (prev - 1 + images.length) % images.length : null
        );
    }, [images.length]);

    const handleNext = useCallback(() => {
        setSelectedIndex((prev) => (prev !== null ? (prev + 1) % images.length : null));
    }, [images.length]);

    // Keyboard navigation
    useEffect(() => {
        if (selectedIndex === null) return;

        function handleKeyDown(e: KeyboardEvent) {
            switch (e.key) {
                case "Escape":
                    handleClose();
                    break;
                case "ArrowLeft":
                    handlePrev();
                    break;
                case "ArrowRight":
                    handleNext();
                    break;
            }
        }

        document.addEventListener("keydown", handleKeyDown);
        // Prevent body scroll when lightbox is open
        document.body.style.overflow = "hidden";

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.body.style.overflow = "";
        };
    }, [selectedIndex, handleClose, handlePrev, handleNext]);

    if (images.length === 0) {
        return (
            <section className={styles.portfolioSection}>
                <h2 className={styles.sectionTitle}>Портфолио</h2>
                <div className={styles.portfolioPlaceholder}>
                    <p className={styles.portfolioPlaceholderText}>
                        Портфолио обновляется — скоро здесь появятся фото работ
                    </p>
                </div>
            </section>
        );
    }

    return (
        <section className={styles.portfolioSection}>
            <h2 className={styles.sectionTitle}>Портфолио</h2>

            <div className={styles.portfolioGrid}>
                {images.map((img, index) => (
                    <button
                        key={img.id}
                        type="button"
                        onClick={() => setSelectedIndex(index)}
                        aria-label={img.description || `Фото работы ${index + 1}`}
                        style={{ all: "unset", cursor: "pointer" }}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={img.thumbnailUrl || img.imageUrl}
                            alt={img.description || `Работа ${index + 1}`}
                            className={styles.portfolioThumb}
                            loading="lazy"
                        />
                    </button>
                ))}
            </div>

            {/* Lightbox */}
            <AnimatePresence>
                {selectedIndex !== null && (
                    <motion.div
                        className={styles.lightboxOverlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        onClick={handleClose}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Просмотр фото"
                    >
                        <motion.img
                            key={selectedIndex}
                            src={images[selectedIndex].imageUrl}
                            alt={images[selectedIndex].description || `Работа ${selectedIndex + 1}`}
                            className={styles.lightboxImage}
                            initial={{ scale: 0.9, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.9, opacity: 0 }}
                            transition={{
                                duration: 0.25,
                                ease: [0.22, 0.9, 0.32, 1],
                            }}
                            onClick={(e) => e.stopPropagation()}
                        />

                        <button
                            className={styles.lightboxClose}
                            onClick={handleClose}
                            aria-label="Закрыть"
                        >
                            ✕
                        </button>

                        {images.length > 1 && (
                            <>
                                <button
                                    className={styles.lightboxPrev}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handlePrev();
                                    }}
                                    aria-label="Предыдущее фото"
                                >
                                    ←
                                </button>
                                <button
                                    className={styles.lightboxNext}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleNext();
                                    }}
                                    aria-label="Следующее фото"
                                >
                                    →
                                </button>
                            </>
                        )}

                        <span className={styles.lightboxCounter}>
                            {selectedIndex + 1} / {images.length}
                        </span>
                    </motion.div>
                )}
            </AnimatePresence>
        </section>
    );
}
