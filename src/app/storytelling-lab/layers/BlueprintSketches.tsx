"use client";

import styles from "./layers.module.css";
import type { LayerProps } from "./types";

/**
 * 09 — Blueprint / CAD sketches in the background.
 *
 * Faint technical-drawing-style overlay behind the floating piece —
 * dimension lines, callouts, side views. "Designed, not decorated."
 */
export default function BlueprintSketches({ activeJewelry, items }: LayerProps) {
    const current = items[activeJewelry];
    const gauge = current.gauge;
    return (
        <div className={styles.blueprint} aria-hidden="true">
            <svg viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
                {/* Dimension line + callout — diameter */}
                <g stroke="rgba(255,45,138,0.32)" strokeWidth="0.7" fill="none">
                    <line x1="380" y1="380" x2="380" y2="280" />
                    <line x1="820" y1="380" x2="820" y2="280" />
                    <line x1="380" y1="320" x2="820" y2="320" />
                    <polygon
                        points="380,320 392,316 392,324"
                        fill="rgba(255,45,138,0.32)"
                        stroke="none"
                    />
                    <polygon
                        points="820,320 808,316 808,324"
                        fill="rgba(255,45,138,0.32)"
                        stroke="none"
                    />
                </g>
                <text
                    x="600"
                    y="312"
                    textAnchor="middle"
                    style={{
                        font: "9px var(--font-mono, monospace)",
                        letterSpacing: "0.18em",
                        fill: "rgba(255,45,138,0.6)",
                    }}
                >
                    {`Ø ${gauge}`}
                </text>

                {/* Side view callout */}
                <g stroke="rgba(240,240,240,0.12)" strokeWidth="0.7" fill="none">
                    <line x1="900" y1="420" x2="1020" y2="420" />
                    <line x1="900" y1="500" x2="1020" y2="500" />
                    <line x1="960" y1="420" x2="960" y2="500" />
                </g>
                <text
                    x="970"
                    y="463"
                    textAnchor="start"
                    style={{
                        font: "8px var(--font-mono, monospace)",
                        letterSpacing: "0.2em",
                        fill: "rgba(240,240,240,0.4)",
                        textTransform: "uppercase" as const,
                    }}
                >
                    {current.weight}
                </text>

                {/* Callout dot + leader line for material */}
                <g stroke="rgba(240,240,240,0.18)" strokeWidth="0.7" fill="none">
                    <circle cx="540" cy="600" r="3" fill="rgba(255,45,138,0.4)" />
                    <line x1="540" y1="600" x2="240" y2="700" />
                </g>
                <text
                    x="240"
                    y="690"
                    textAnchor="start"
                    style={{
                        font: "8px var(--font-mono, monospace)",
                        letterSpacing: "0.18em",
                        fill: "rgba(240,240,240,0.45)",
                    }}
                >
                    {current.material.toUpperCase()}
                </text>

                {/* Faint grid lines */}
                <g stroke="rgba(255,255,255,0.04)" strokeWidth="0.5">
                    {Array.from({ length: 12 }, (_, i) => (
                        <line key={`v${i}`} x1={(i + 1) * 100} y1="0" x2={(i + 1) * 100} y2="800" />
                    ))}
                    {Array.from({ length: 8 }, (_, i) => (
                        <line
                            key={`h${i}`}
                            x1="0"
                            y1={(i + 1) * 100}
                            x2="1200"
                            y2={(i + 1) * 100}
                        />
                    ))}
                </g>
            </svg>
        </div>
    );
}
