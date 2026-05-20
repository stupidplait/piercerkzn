"use client";

import styles from "./layers.module.css";
import type { LayerProps } from "./types";

/**
 * 01 — Podium / pedestal.
 *
 * SVG-rendered two-tier elliptical pedestal. The shading sells volume:
 *   • Each tier has a flat ellipse on top with a radial gradient (lighter
 *     centre, darker rim) — reads as a curved horizontal surface.
 *   • Below each top ellipse sits a curved trapezoid "side band" with a
 *     vertical linear gradient (lighter top, darker bottom) — reads as
 *     the cylinder face.
 *   • A blurred ground shadow grounds the whole structure.
 *
 * Drawn back-to-front: shadow → bottom side → bottom top → top side →
 * top top → specular highlight.
 *
 * Clean — no engraving. Matches the reference screenshot. Piece name
 * lives in the chapter card and bottom spec block.
 */
export default function Podium(_: LayerProps) {
    return (
        <div className={styles.podium} aria-hidden="true">
            <svg
                className={styles.podiumSvg}
                viewBox="0 0 400 230"
                preserveAspectRatio="xMidYMax meet"
                role="presentation"
            >
                <defs>
                    {/* Bottom tier: top surface */}
                    <radialGradient id="podiumBottomTop" cx="50%" cy="40%" r="58%">
                        <stop offset="0%" stopColor="#fbfbfb" />
                        <stop offset="55%" stopColor="#e8e8e8" />
                        <stop offset="100%" stopColor="#b4b4b4" />
                    </radialGradient>

                    {/* Bottom tier: side band */}
                    <linearGradient id="podiumBottomSide" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#d8d8d8" />
                        <stop offset="55%" stopColor="#a4a4a4" />
                        <stop offset="100%" stopColor="#6f6f6f" />
                    </linearGradient>

                    {/* Top tier: top surface */}
                    <radialGradient id="podiumTopTop" cx="50%" cy="38%" r="58%">
                        <stop offset="0%" stopColor="#ffffff" />
                        <stop offset="50%" stopColor="#ededed" />
                        <stop offset="100%" stopColor="#bcbcbc" />
                    </radialGradient>

                    {/* Top tier: side band */}
                    <linearGradient id="podiumTopSide" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#e2e2e2" />
                        <stop offset="50%" stopColor="#b0b0b0" />
                        <stop offset="100%" stopColor="#7c7c7c" />
                    </linearGradient>

                    {/* Soft drop shadow under the whole structure */}
                    <filter id="podiumShadow" x="-30%" y="-50%" width="160%" height="200%">
                        <feGaussianBlur stdDeviation="6" />
                    </filter>

                    {/* Subtle gloss highlight — small blurred ellipse */}
                    <filter id="podiumGloss" x="-30%" y="-50%" width="160%" height="200%">
                        <feGaussianBlur stdDeviation="3" />
                    </filter>
                </defs>

                {/* Ground shadow — soft elliptical haze under the base */}
                <ellipse
                    cx="200"
                    cy="218"
                    rx="178"
                    ry="9"
                    fill="rgba(0,0,0,0.55)"
                    filter="url(#podiumShadow)"
                />

                {/* ── Bottom tier ── */}
                {/* Side band: curved trapezoid drawn from the bottom-tier top
                    ellipse downward to a slightly smaller flat-bottom edge.
                    Two arcs trace the front-facing visible curve. */}
                <path
                    d="M 22,180
                       A 178,28 0 0 0 378,180
                       L 378,165
                       A 178,28 0 0 1 22,165 Z"
                    fill="url(#podiumBottomSide)"
                />
                {/* Top ellipse */}
                <ellipse cx="200" cy="165" rx="178" ry="28" fill="url(#podiumBottomTop)" />

                {/* ── Top tier ── */}
                <path
                    d="M 60,128
                       A 140,22 0 0 0 340,128
                       L 340,113
                       A 140,22 0 0 1 60,113 Z"
                    fill="url(#podiumTopSide)"
                />
                <ellipse cx="200" cy="113" rx="140" ry="22" fill="url(#podiumTopTop)" />

                {/* Specular highlight on the very top — narrow blurred ellipse */}
                <ellipse
                    cx="200"
                    cy="106"
                    rx="92"
                    ry="5"
                    fill="rgba(255,255,255,0.55)"
                    filter="url(#podiumGloss)"
                />
            </svg>
        </div>
    );
}
