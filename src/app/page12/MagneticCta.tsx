"use client";

/**
 * MagneticCta (page12) — pointer-attracted anchor for the primary CTA.
 * Writes `--magX` / `--magY` on the element; CSS consumes them via
 * `[data-magnetic="1"]`. Soft damping inside a 160 px radius; releases
 * instantly when the pointer exits the radius. No state, no re-renders.
 */

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
    children: ReactNode;
    className?: string;
    href?: string;
    radius?: number;
    strength?: number;
};

export function MagneticCta({ children, className, href, radius = 160, strength = 0.28 }: Props) {
    const ref = useRef<HTMLAnchorElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reduce) return;

        let tx = 0;
        let ty = 0;
        let targetX = 0;
        let targetY = 0;
        let raf = 0;
        let active = false;

        const loop = () => {
            const k = 0.18;
            tx += (targetX - tx) * k;
            ty += (targetY - ty) * k;
            el.style.setProperty("--magX", `${tx.toFixed(2)}px`);
            el.style.setProperty("--magY", `${ty.toFixed(2)}px`);
            if (Math.abs(tx - targetX) < 0.05 && Math.abs(ty - targetY) < 0.05 && !active) {
                raf = 0;
                return;
            }
            raf = requestAnimationFrame(loop);
        };
        const ensureLoop = () => {
            if (!raf) raf = requestAnimationFrame(loop);
        };

        const onMove = (e: PointerEvent) => {
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const dx = e.clientX - cx;
            const dy = e.clientY - cy;
            const d = Math.hypot(dx, dy);
            if (d > radius) {
                active = false;
                targetX = 0;
                targetY = 0;
            } else {
                active = true;
                const falloff = 1 - d / radius;
                targetX = dx * strength * falloff;
                targetY = dy * strength * falloff;
            }
            ensureLoop();
        };

        const onLeave = () => {
            active = false;
            targetX = 0;
            targetY = 0;
            ensureLoop();
        };

        window.addEventListener("pointermove", onMove, { passive: true });
        el.addEventListener("pointerleave", onLeave);
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("pointermove", onMove);
            el.removeEventListener("pointerleave", onLeave);
        };
    }, [radius, strength]);

    return (
        <a ref={ref} href={href} className={className} data-magnetic="1">
            {children}
        </a>
    );
}
