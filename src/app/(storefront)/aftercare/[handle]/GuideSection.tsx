import styles from "./aftercare-detail.module.css";

// ---------------------------------------------------------------------------
// Types for the JSONB content structure
// ---------------------------------------------------------------------------

interface TimelineEntry {
    week_start?: number;
    week_end?: number;
    week?: number;
    title?: string;
    description?: string;
    note?: string;
}

interface RoutineEntry {
    step?: number;
    instruction?: string;
    icon?: string;
}

interface DownsizingInfo {
    recommended_at_weeks?: number;
    description?: string;
}

export interface AftercareContent {
    overview?: string;
    timeline?: TimelineEntry[] | null;
    daily_routine?: (RoutineEntry | string)[] | null;
    dos?: string[] | null;
    donts?: string[] | null;
    warning_signs?: string[] | null;
    downsizing?: DownsizingInfo | string | null;
}

// ---------------------------------------------------------------------------
// Section labels (Russian)
// ---------------------------------------------------------------------------

const SECTION_LABELS: Record<string, string> = {
    overview: "Обзор",
    timeline: "Этапы заживления",
    daily_routine: "Ежедневный уход",
    dos: "Рекомендации",
    donts: "Чего избегать",
    warning_signs: "Тревожные признаки",
    downsizing: "Даунсайзинг",
};

// ---------------------------------------------------------------------------
// GuideSection Component
// ---------------------------------------------------------------------------

interface GuideSectionProps {
    content: AftercareContent;
}

export function GuideSection({ content }: GuideSectionProps) {
    return (
        <>
            {/* Overview */}
            {content.overview && (
                <section className={styles.guideSection} aria-labelledby="section-overview">
                    <h2 id="section-overview" className={styles.sectionTitle}>
                        {SECTION_LABELS.overview}
                    </h2>
                    <p className={styles.sectionText}>{content.overview}</p>
                </section>
            )}

            {/* Healing Timeline */}
            {content.timeline && content.timeline.length > 0 && (
                <section className={styles.guideSection} aria-labelledby="section-timeline">
                    <h2 id="section-timeline" className={styles.sectionTitle}>
                        {SECTION_LABELS.timeline}
                    </h2>
                    <ul className={styles.timelineList}>
                        {content.timeline.map((entry, idx) => (
                            <li key={idx} className={styles.timelineItem}>
                                <span className={styles.timelineWeek}>
                                    {formatTimelineWeek(entry)}
                                </span>
                                <div>
                                    {entry.title && (
                                        <h3 className={styles.timelineTitle}>{entry.title}</h3>
                                    )}
                                    <p className={styles.timelineDesc}>
                                        {entry.description || entry.note || ""}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* Daily Routine */}
            {content.daily_routine && content.daily_routine.length > 0 && (
                <section className={styles.guideSection} aria-labelledby="section-routine">
                    <h2 id="section-routine" className={styles.sectionTitle}>
                        {SECTION_LABELS.daily_routine}
                    </h2>
                    <ol className={styles.routineList}>
                        {content.daily_routine.map((entry, idx) => (
                            <li key={idx} className={styles.routineItem}>
                                <span className={styles.routineStep}>
                                    {typeof entry === "string" ? idx + 1 : (entry.step ?? idx + 1)}
                                </span>
                                <span className={styles.routineText}>
                                    {typeof entry === "string" ? entry : (entry.instruction ?? "")}
                                </span>
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            {/* Dos */}
            {content.dos && content.dos.length > 0 && (
                <section className={styles.guideSection} aria-labelledby="section-dos">
                    <h2 id="section-dos" className={styles.sectionTitle}>
                        {SECTION_LABELS.dos}
                    </h2>
                    <ul className={styles.bulletList}>
                        {content.dos.map((item, idx) => (
                            <li key={idx} className={styles.bulletItem}>
                                <span className={styles.bulletIconDo} aria-hidden="true">
                                    ✓
                                </span>
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* Donts */}
            {content.donts && content.donts.length > 0 && (
                <section className={styles.guideSection} aria-labelledby="section-donts">
                    <h2 id="section-donts" className={styles.sectionTitle}>
                        {SECTION_LABELS.donts}
                    </h2>
                    <ul className={styles.bulletList}>
                        {content.donts.map((item, idx) => (
                            <li key={idx} className={styles.bulletItem}>
                                <span className={styles.bulletIconDont} aria-hidden="true">
                                    ✕
                                </span>
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* Warning Signs */}
            {content.warning_signs && content.warning_signs.length > 0 && (
                <section className={styles.guideSection} aria-labelledby="section-warnings">
                    <h2 id="section-warnings" className={styles.sectionTitle}>
                        {SECTION_LABELS.warning_signs}
                    </h2>
                    <ul className={styles.bulletList}>
                        {content.warning_signs.map((item, idx) => (
                            <li key={idx} className={styles.bulletItem}>
                                <span className={styles.bulletIconWarning} aria-hidden="true">
                                    ⚠
                                </span>
                                <span>{item}</span>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            {/* Downsizing */}
            {content.downsizing && (
                <section className={styles.guideSection} aria-labelledby="section-downsizing">
                    <h2 id="section-downsizing" className={styles.sectionTitle}>
                        {SECTION_LABELS.downsizing}
                    </h2>
                    <div className={styles.downsizingContent}>
                        {typeof content.downsizing === "string" ? (
                            <p className={styles.downsizingText}>{content.downsizing}</p>
                        ) : (
                            <>
                                {content.downsizing.recommended_at_weeks != null && (
                                    <span className={styles.downsizingWeek}>
                                        Рекомендуется на {content.downsizing.recommended_at_weeks}{" "}
                                        неделе
                                    </span>
                                )}
                                {content.downsizing.description && (
                                    <p className={styles.downsizingText}>
                                        {content.downsizing.description}
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                </section>
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimelineWeek(entry: TimelineEntry): string {
    // Support both formats: { week_start, week_end } and { week }
    if (entry.week_start != null && entry.week_end != null) {
        return `${entry.week_start}–${entry.week_end} нед.`;
    }
    if (entry.week != null) {
        return `${entry.week} нед.`;
    }
    return "";
}
