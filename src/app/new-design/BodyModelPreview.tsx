"use client";

import styles from "./page.module.css";
import { useScrollReveal } from "./hooks/useScrollReveal";

/* Body areas — zone IDs match BUST_ANCHORS in WireframeRoom.tsx so the
   active jewelry travels to the correct anchor on the wireframe bust
   when the user picks a zone. */
const BODY_AREAS = [
    { id: "ear_left", label: "Левое ухо", count: 8 },
    { id: "ear_right", label: "Правое ухо", count: 8 },
    { id: "nose", label: "Нос", count: 3 },
    { id: "lip", label: "Губа", count: 4 },
    { id: "eyebrow", label: "Бровь", count: 2 },
    { id: "navel", label: "Пупок", count: 1 },
];

interface BodyModelPreviewProps {
    chapterRef: React.RefObject<HTMLDivElement | null>;
    onAreaChange?: (areaId: string) => void;
    activeArea: string;
}

export default function BodyModelPreview({
    chapterRef,
    onAreaChange,
    activeArea,
}: BodyModelPreviewProps) {
    const { isVisible, progress } = useScrollReveal(chapterRef, { once: false });
    const activeIdx = Math.max(
        0,
        BODY_AREAS.findIndex((a) => a.id === activeArea)
    );
    const activeLabel = BODY_AREAS[activeIdx]?.label ?? "";

    return (
        <div
            id="try-on"
            className={`${styles.chapter} ${styles.chapter2}`}
            ref={chapterRef}
            data-visible={isVisible ? "1" : "0"}
            style={{ "--reveal-progress": Math.min(1, progress * 2) } as React.CSSProperties}
        >
            {/* Bottom-left nameplate — chapter title + active zone label.
                Mirrors Ch1's nameplate character; fills the same corner
                slot. The big "ПРИМЕРЬ" itself is a 3D <Text> in the
                wireframe room (or, if not yet wired, the heading here
                acts as the chapter title placeholder). */}
            <div className={styles.nameplate} aria-live="polite">
                <span className={styles.nameplateChapter}>Глава 02</span>
                <span className={styles.nameplateRule} aria-hidden="true" />
                <span className={styles.nameplateHeading}>ПРИМЕРЬ</span>
                <span className={styles.nameplateSubhead}>Где встанет?</span>
                <span className={styles.nameplateZoneLabel}>{activeLabel}</span>
            </div>

            {/* Vertical zone rail — right edge, mirrors Ch1's rolodex
                character. Each zone is a labeled tick; clicking advances
                the wireframe-bust active anchor. */}
            <div className={styles.zoneRail} aria-label="Зоны пирсинга">
                <div className={styles.zoneRailList}>
                    {BODY_AREAS.map((area, i) => {
                        const isActive = area.id === activeArea;
                        return (
                            <button
                                key={area.id}
                                type="button"
                                className={styles.zoneRailItem}
                                data-active={isActive ? "true" : "false"}
                                onClick={() => onAreaChange?.(area.id)}
                                aria-pressed={isActive ? "true" : "false"}
                                aria-label={area.label}
                            >
                                <span className={styles.zoneRailTick} aria-hidden="true" />
                                <span className={styles.zoneRailIndex}>
                                    {String(i + 1).padStart(2, "0")}
                                </span>
                                <span className={styles.zoneRailLabel}>{area.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

export { BODY_AREAS };
