"use client";

/**
 * Reveal (page12) — IntersectionObserver wrapper that flips `data-in="1"`
 * when the element enters the viewport. CSS handles the actual transition.
 *
 * Use `threshold` and `rootMargin` via props if a section needs to trigger
 * earlier or later. Wraps any block or section.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
    children: ReactNode;
    className?: string;
    delay?: number;
    threshold?: number;
    rootMargin?: string;
    once?: boolean;
};

export function Reveal({
    children,
    className,
    delay = 0,
    threshold = 0.22,
    rootMargin = "0px 0px -14% 0px",
    once = true,
}: Props) {
    const ref = useRef<HTMLDivElement>(null);
    const [inView, setInView] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const io = new IntersectionObserver(
            (entries) => {
                for (const e of entries) {
                    if (e.isIntersecting) {
                        setInView(true);
                        if (once) io.disconnect();
                    } else if (!once) {
                        setInView(false);
                    }
                }
            },
            { threshold, rootMargin }
        );
        io.observe(el);
        return () => io.disconnect();
    }, [threshold, rootMargin, once]);

    return (
        <div
            ref={ref}
            className={className}
            data-in={inView ? "1" : "0"}
            style={delay ? { transitionDelay: `${delay}ms` } : undefined}
        >
            {children}
        </div>
    );
}
