"use client";

import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";

import styles from "./product-detail.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MediaItem {
    id: string;
    url: string;
    alt: string | null;
    kind: string;
    sortOrder: number;
}

interface MediaGalleryProps {
    media: MediaItem[];
    productTitle: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MediaGallery({ media, productTitle }: MediaGalleryProps) {
    const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true });
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [canScrollPrev, setCanScrollPrev] = useState(false);
    const [canScrollNext, setCanScrollNext] = useState(false);

    const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi]);
    const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi]);

    const onSelect = useCallback(() => {
        if (!emblaApi) return;
        setSelectedIndex(emblaApi.selectedScrollSnap());
        setCanScrollPrev(emblaApi.canScrollPrev());
        setCanScrollNext(emblaApi.canScrollNext());
    }, [emblaApi]);

    useEffect(() => {
        if (!emblaApi) return;
        onSelect();
        emblaApi.on("select", onSelect);
        emblaApi.on("reInit", onSelect);
        return () => {
            emblaApi.off("select", onSelect);
            emblaApi.off("reInit", onSelect);
        };
    }, [emblaApi, onSelect]);

    // If no media, show placeholder
    if (media.length === 0) {
        return (
            <div className={styles.galleryPlaceholder}>
                <span className={styles.galleryPlaceholderText}>Нет изображений</span>
            </div>
        );
    }

    // Single image — no carousel needed
    if (media.length === 1) {
        const item = media[0];
        return (
            <div className={styles.gallerySingle}>
                <img
                    src={item.url}
                    alt={item.alt || productTitle}
                    className={styles.galleryImage}
                />
            </div>
        );
    }

    return (
        <div className={styles.gallery}>
            {/* Main carousel */}
            <div className={styles.galleryViewport} ref={emblaRef}>
                <div className={styles.galleryContainer}>
                    {media.map((item) => (
                        <div key={item.id} className={styles.gallerySlide}>
                            <img
                                src={item.url}
                                alt={item.alt || productTitle}
                                className={styles.galleryImage}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {/* Navigation arrows (desktop) */}
            <button
                type="button"
                className={`${styles.galleryArrow} ${styles.galleryArrowPrev}`}
                onClick={scrollPrev}
                disabled={!canScrollPrev}
                aria-label="Предыдущее изображение"
            >
                ‹
            </button>
            <button
                type="button"
                className={`${styles.galleryArrow} ${styles.galleryArrowNext}`}
                onClick={scrollNext}
                disabled={!canScrollNext}
                aria-label="Следующее изображение"
            >
                ›
            </button>

            {/* Dot indicators */}
            {media.length > 1 && (
                <div
                    className={styles.galleryDots}
                    role="tablist"
                    aria-label="Навигация по изображениям"
                >
                    {media.map((item, index) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`${styles.galleryDot} ${index === selectedIndex ? styles.galleryDotActive : ""}`}
                            onClick={() => emblaApi?.scrollTo(index)}
                            role="tab"
                            aria-selected={index === selectedIndex}
                            aria-label={`Изображение ${index + 1}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
