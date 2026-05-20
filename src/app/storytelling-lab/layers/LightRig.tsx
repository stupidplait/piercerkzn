"use client";

import styles from "./layers.module.css";

/**
 * 06 — Off-screen light rig hints.
 *
 * Three thin dotted rays converging on the centre of the stage with
 * tiny aperture-style icons at the screen edges. Implies a photo studio
 * / professional lighting setup. No animation — atmospheric only.
 */
export default function LightRig() {
    return (
        <div className={styles.rig} aria-hidden="true">
            {[
                { from: "top-left", x: 0, y: 0, angle: 35 },
                { from: "top-right", x: 100, y: 0, angle: -35 },
                { from: "bottom-left", x: 0, y: 100, angle: -50 },
            ].map((r, i) => (
                <div
                    key={i}
                    className={styles.rigBeam}
                    style={{
                        left: `${r.x}%`,
                        top: `${r.y}%`,
                        transform: `rotate(${r.angle}deg)`,
                    }}
                />
            ))}
            <div className={styles.rigAperture} style={{ left: "8%", top: "10%" }}>
                <ApertureIcon />
            </div>
            <div className={styles.rigAperture} style={{ right: "8%", top: "10%" }}>
                <ApertureIcon />
            </div>
            <div className={styles.rigAperture} style={{ left: "8%", bottom: "16%" }}>
                <ApertureIcon />
            </div>
        </div>
    );
}

function ApertureIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 3v9l7 5M3 12l9-9 5 7M21 12l-9 9-5-7" strokeLinecap="round" />
        </svg>
    );
}
