"use client";

import styles from "./layers.module.css";
import type { LayerProps } from "./types";

/** 03 — Body-area glyph in upper-right showing where the active piece is worn. */

const AREA_BY_PIECE: Record<string, { glyph: React.ReactNode; label: string }> = {
    "cross-earring": { glyph: <EarGlyph />, label: "Мочка / Лобе" },
    labret: { glyph: <LipGlyph />, label: "Губа / Лабрет" },
    "hoop-earring": { glyph: <EarGlyph />, label: "Хеликс / Ухо" },
    "stud-earring": { glyph: <EarGlyph />, label: "Мочка / Лобе" },
    barbell: { glyph: <BrowGlyph />, label: "Бровь / Соски" },
    "septum-ring": { glyph: <NoseGlyph />, label: "Септум / Нос" },
};

function EarGlyph() {
    return (
        <svg
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
        >
            <path d="M11 8c0-3 2-5 5-5s7 1 7 6c0 3-3 4-3 7s2 4 0 7c-1 1-3 2-4 2-3 0-4-2-4-4 0-2 1-3 1-5s-2-3-2-8z" />
            <circle cx="15" cy="13" r="1.2" fill="currentColor" />
        </svg>
    );
}
function LipGlyph() {
    return (
        <svg
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
        >
            <path d="M5 16c2-4 8-6 11-6s9 2 11 6c-2 4-8 6-11 6S7 20 5 16z" />
            <circle cx="16" cy="20" r="1.2" fill="currentColor" />
        </svg>
    );
}
function NoseGlyph() {
    return (
        <svg
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
        >
            <path d="M16 4c-2 4-4 8-4 14 0 4 2 8 4 8s4-4 4-8c0-6-2-10-4-14z" />
            <circle cx="16" cy="20" r="1.2" fill="currentColor" />
        </svg>
    );
}
function BrowGlyph() {
    return (
        <svg
            viewBox="0 0 32 32"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
        >
            <path d="M5 14c4-3 12-3 22 0" />
            <circle cx="14" cy="14" r="1.2" fill="currentColor" />
            <path d="M5 22c4-2 12-2 22 0" />
        </svg>
    );
}

export default function BodyAreaIndicator({ activeJewelry, items }: LayerProps) {
    const current = items[activeJewelry];
    const area = AREA_BY_PIECE[current.id] ?? AREA_BY_PIECE["cross-earring"];

    return (
        <div className={styles.bodyArea} aria-hidden="true" key={current.id}>
            <div className={styles.bodyAreaIcon}>{area.glyph}</div>
            <div className={styles.bodyAreaText}>
                <span className={styles.bodyAreaKicker}>зона</span>
                <span className={styles.bodyAreaLabel}>{area.label}</span>
            </div>
        </div>
    );
}
