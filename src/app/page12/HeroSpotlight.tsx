"use client";

import { useEffect, useRef } from "react";

/**
 * HeroSpotlight — writes --mx / --my CSS vars on the hero element so a
 * radial gradient tracks the pointer. No React re-renders; pure DOM writes.
 */
export function HeroSpotlight() {
    const probe = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const el = probe.current?.parentElement;
        if (!el) return;
        const set = (e: PointerEvent) => {
            const r = el.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * 100;
            const y = ((e.clientY - r.top) / r.height) * 100;
            el.style.setProperty("--mx", `${x}%`);
            el.style.setProperty("--my", `${y}%`);
        };
        el.addEventListener("pointermove", set);
        return () => el.removeEventListener("pointermove", set);
    }, []);

    return <span ref={probe} style={{ display: "none" }} aria-hidden />;
}
