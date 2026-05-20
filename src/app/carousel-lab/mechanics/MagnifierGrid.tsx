"use client";

import { useEffect, useState } from "react";
import styles from "./mechanics.module.css";
import type { MechanicProps } from "./types";

/**
 * 06 — Сетка / Magnifier Grid.
 *
 * Default state shows all 6 pieces as a 3×2 grid of tiles, each with
 * a name + index + tiny abstract glyph. Click a tile = the grid fades
 * back, the 3D piece is showcased, that piece becomes active. Click
 * the small "Сетка" pill to return to the grid.
 *
 * When the lab page first opens this mechanic, grid is shown; otherwise
 * we respect the active piece (collapsed). User can toggle freely.
 */

const GLYPHS = ["✦", "◐", "◯", "✧", "│", "⌒"];

export default function MagnifierGrid({ activeJewelry, items, goToIndex }: MechanicProps) {
    const [expanded, setExpanded] = useState(true);

    // When the active piece changes (e.g. via keyboard arrows), collapse
    // the grid so the user can see what they picked.
    useEffect(() => {
        setExpanded(false);
    }, [activeJewelry]);

    return (
        <div className={styles.gridRoot}>
            {expanded ? (
                <div className={styles.gridSheet}>
                    <div className={styles.gridGutter}>
                        {items.map((item, i) => (
                            <button
                                key={item.id}
                                type="button"
                                className={styles.gridTile}
                                data-active={i === activeJewelry ? "true" : "false"}
                                onClick={() => {
                                    goToIndex(i);
                                    setExpanded(false);
                                }}
                            >
                                <span className={styles.gridGlyph} aria-hidden="true">
                                    {GLYPHS[i % GLYPHS.length]}
                                </span>
                                <span className={styles.gridTileNum}>
                                    {String(i + 1).padStart(2, "0")}
                                </span>
                                <span className={styles.gridTileName}>{item.name}</span>
                                <span className={styles.gridTilePrice}>{item.price}</span>
                            </button>
                        ))}
                    </div>
                </div>
            ) : (
                <button
                    type="button"
                    className={styles.gridReopen}
                    onClick={() => setExpanded(true)}
                >
                    <span className={styles.gridReopenIcon} aria-hidden="true">
                        ⊞
                    </span>
                    <span>Все украшения</span>
                </button>
            )}
        </div>
    );
}
