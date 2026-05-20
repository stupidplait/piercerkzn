"use client";

import { useEffect, useRef } from "react";
import styles from "./page.module.css";

interface Ch2ZoneMarkerProps {
    activeArea: string;
    ch2BodyPhase: React.RefObject<number>;
}

/* Each zone snaps to a major-cell intersection on the 2D grid.
   Coordinates are in major cells from viewport center (+y down).
   This is the abstract anatomy chart — the grid IS the body diagram,
   and each zone has a fixed coordinate the marker travels to.

       (0, -1) Бровь
   (-1, 0)  (0, 0)  (+1, 0)
   ЛевУхо    Нос     ПравУхо
            (0, +1) Губа
            (0, +2) Пупок                                        */
const ZONE_COORDS: Record<string, [number, number]> = {
    ear_left: [-1, 0],
    ear_right: [+1, 0],
    nose: [0, 0],
    eyebrow: [0, -1],
    lip: [0, +1],
    navel: [0, +2],
};

/* Major-cell px size. Must match `--major-cell` in page.module.css
   (= --cell × 5 = 56 × 5 = 280). Hardcoded here because reading the
   CSS variable at runtime is fragile during transform animations. */
const MAJOR_CELL_PX = 280;

/**
 * Ch2ZoneMarker — magenta dot anchored at a grid intersection,
 * sliding between zones as the user picks. Visible only while the
 * 2D grid is fully revealed (ch2BodyPhase 0.18 → 0.82).
 *
 * Uses CSS transform translate for the slide so the GPU handles it
 * (no layout reflow). Ease-out-expo curve keeps it snappy and
 * confident — no bounce, no elastic.
 */
export default function Ch2ZoneMarker({ activeArea, ch2BodyPhase }: Ch2ZoneMarkerProps) {
    const ref = useRef<HTMLDivElement | null>(null);

    /* Drive opacity from ch2BodyPhase via rAF. The marker fades in
       once the grid has landed (0.18) and fades out before the grid
       slides back down (0.82). */
    useEffect(() => {
        let raf = 0;
        const tick = () => {
            const ph = ch2BodyPhase.current ?? 0;
            // Fade window 0.18 → 0.30 in, 0.75 → 0.82 out.
            const inT = Math.max(0, Math.min(1, (ph - 0.18) / 0.12));
            const outT = Math.max(0, Math.min(1, (ph - 0.75) / 0.07));
            const inEased = inT * inT * (3 - 2 * inT);
            const outEased = outT * outT * (3 - 2 * outT);
            const opacity = inEased * (1 - outEased);
            const el = ref.current;
            if (el) el.style.opacity = String(opacity);
            raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [ch2BodyPhase]);

    const coords = ZONE_COORDS[activeArea] ?? ZONE_COORDS.ear_left;
    const x = coords[0] * MAJOR_CELL_PX;
    const y = coords[1] * MAJOR_CELL_PX;

    return (
        <div
            ref={ref}
            className={styles.ch2ZoneMarker}
            style={
                {
                    "--marker-x": `${x}px`,
                    "--marker-y": `${y}px`,
                } as React.CSSProperties
            }
            aria-hidden="true"
        />
    );
}
