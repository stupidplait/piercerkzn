"use client";

import styles from "./layers.module.css";

/**
 * 10 — Studio floor plan / "вы здесь" badge.
 *
 * Tiny overhead floor-plan icon in the upper-left, with a "you are here"
 * marker. Pulls the digital experience back to a physical Kazan studio.
 */
export default function StudioMap() {
    return (
        <div className={styles.studio} aria-hidden="true">
            <span className={styles.studioKicker}>СТУДИЯ KZN</span>
            <svg className={styles.studioPlan} viewBox="0 0 100 60" fill="none">
                {/* Outer walls */}
                <rect
                    x="2"
                    y="2"
                    width="96"
                    height="56"
                    stroke="rgba(240,240,240,0.45)"
                    strokeWidth="1.2"
                />
                {/* Inner partition */}
                <line
                    x1="60"
                    y1="2"
                    x2="60"
                    y2="40"
                    stroke="rgba(240,240,240,0.32)"
                    strokeWidth="0.8"
                />
                <line
                    x1="60"
                    y1="48"
                    x2="60"
                    y2="58"
                    stroke="rgba(240,240,240,0.32)"
                    strokeWidth="0.8"
                />
                {/* Reception desk */}
                <rect x="8" y="48" width="22" height="6" fill="rgba(240,240,240,0.18)" />
                {/* Piercing chair (indicated by circle) */}
                <circle
                    cx="78"
                    cy="22"
                    r="6"
                    fill="none"
                    stroke="rgba(240,240,240,0.45)"
                    strokeWidth="0.8"
                />
                <line
                    x1="78"
                    y1="16"
                    x2="78"
                    y2="28"
                    stroke="rgba(240,240,240,0.45)"
                    strokeWidth="0.6"
                />
                {/* "Вы здесь" marker — at the chair */}
                <circle cx="78" cy="22" r="2.5" fill="var(--accent, #ff2d8a)" />
                <circle
                    cx="78"
                    cy="22"
                    r="6"
                    fill="none"
                    stroke="var(--accent, #ff2d8a)"
                    strokeWidth="0.4"
                    opacity="0.5"
                >
                    <animate
                        attributeName="r"
                        values="6;10;6"
                        dur="2.4s"
                        repeatCount="indefinite"
                    />
                    <animate
                        attributeName="opacity"
                        values="0.5;0;0.5"
                        dur="2.4s"
                        repeatCount="indefinite"
                    />
                </circle>
            </svg>
            <span className={styles.studioLabel}>вы здесь · кресло мастера</span>
        </div>
    );
}
