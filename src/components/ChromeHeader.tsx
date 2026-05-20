"use client";

/**
 * ChromeHeader — hide-on-scroll, reveal on upward scroll OR when
 * the cursor approaches the top 64px of the viewport.
 *
 * State rules:
 *   - scrollY < 80            → visible
 *   - scrollY >= 120 + down   → hidden
 *   - any upward delta > 4px  → visible
 *   - pointerY <= 64          → visible (even while scrolling down)
 */

import { useEffect, useState, type ReactNode } from "react";

export function ChromeHeader({ children, className }: { children: ReactNode; className: string }) {
    const [hidden, setHidden] = useState(false);

    useEffect(() => {
        let lastY = window.scrollY;
        let nearTop = false;
        let raf = 0;
        let pending = false;

        const evaluate = () => {
            pending = false;
            const y = window.scrollY;
            const dy = y - lastY;
            let next = hidden;
            if (y < 80 || nearTop) {
                next = false;
            } else if (dy > 4 && y > 120) {
                next = true;
            } else if (dy < -4) {
                next = false;
            }
            if (next !== hidden) setHidden(next);
            lastY = y;
        };

        const onScroll = () => {
            if (pending) return;
            pending = true;
            raf = requestAnimationFrame(evaluate);
        };

        const onMove = (e: PointerEvent) => {
            const was = nearTop;
            nearTop = e.clientY <= 64;
            if (was !== nearTop) evaluate();
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("pointermove", onMove, { passive: true });
        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("pointermove", onMove);
        };
    }, [hidden]);

    return (
        <nav className={className} data-hidden={hidden ? "1" : "0"}>
            {children}
        </nav>
    );
}
