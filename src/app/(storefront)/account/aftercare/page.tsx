import { desc, eq, and } from "drizzle-orm";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { db, aftercareTracking } from "@/db";

import styles from "./aftercare.module.css";

export const dynamic = "force-dynamic";

interface DailyLogEntry {
    date: string;
    tasks_completed?: string[];
    notes?: string;
}

export default async function AccountAftercarePage() {
    const session = await auth();
    const customerId = session!.user!.customerId!;

    const trackingEntries = await db
        .select({
            id: aftercareTracking.id,
            piercingType: aftercareTracking.piercingType,
            piercingDate: aftercareTracking.piercingDate,
            dailyLog: aftercareTracking.dailyLog,
            isActive: aftercareTracking.isActive,
            createdAt: aftercareTracking.createdAt,
        })
        .from(aftercareTracking)
        .where(
            and(eq(aftercareTracking.customerId, customerId), eq(aftercareTracking.isActive, true))
        )
        .orderBy(desc(aftercareTracking.createdAt));

    return (
        <div className={styles.page}>
            <h1 className={styles.pageTitle}>Уход за пирсингом</h1>

            {trackingEntries.length === 0 ? (
                <div className={styles.emptyState}>
                    <p className={styles.emptyText}>У вас нет активных записей по уходу</p>
                    <Link href="/aftercare" className={styles.ctaLink}>
                        Посмотреть гайды по уходу
                    </Link>
                </div>
            ) : (
                <ul className={styles.list}>
                    {trackingEntries.map((entry) => {
                        const dayNumber = getDayNumber(entry.piercingDate);
                        const completionPercent = getCompletionPercent(
                            entry.dailyLog as DailyLogEntry[] | null,
                            dayNumber
                        );

                        return (
                            <li key={entry.id} className={styles.card}>
                                <div className={styles.cardHeader}>
                                    <span className={styles.piercingType}>
                                        {piercingTypeLabel(entry.piercingType)}
                                    </span>
                                    <span className={styles.dayBadge}>День {dayNumber}</span>
                                </div>
                                <div className={styles.cardBody}>
                                    <span className={styles.startDate}>
                                        Начало: {formatDate(entry.piercingDate)}
                                    </span>
                                    <div className={styles.progressWrap}>
                                        <div className={styles.progressBar}>
                                            <div
                                                className={styles.progressFill}
                                                style={{ width: `${completionPercent}%` }}
                                            />
                                        </div>
                                        <span className={styles.progressLabel}>
                                            {completionPercent}%
                                        </span>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

// ── Helpers ──

function getDayNumber(piercingDate: string | null): number {
    if (!piercingDate) return 0;
    const start = new Date(piercingDate + "T00:00:00+03:00");
    const now = new Date();
    const diffMs = now.getTime() - start.getTime();
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

function getCompletionPercent(dailyLog: DailyLogEntry[] | null, totalDays: number): number {
    if (!dailyLog || !Array.isArray(dailyLog) || totalDays === 0) return 0;
    const completedDays = dailyLog.filter(
        (entry) => entry.tasks_completed && entry.tasks_completed.length > 0
    ).length;
    return Math.min(100, Math.round((completedDays / totalDays) * 100));
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr + "T00:00:00+03:00");
    return d.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/Moscow",
    });
}

function piercingTypeLabel(type: string): string {
    const map: Record<string, string> = {
        helix: "Хеликс",
        tragus: "Трагус",
        conch: "Конч",
        lobe: "Мочка",
        septum: "Септум",
        nostril: "Нострил",
        lip: "Губа",
        navel: "Пупок",
        eyebrow: "Бровь",
        tongue: "Язык",
        daith: "Дейт",
        rook: "Рук",
        industrial: "Индастриал",
        flat: "Флэт",
        forward_helix: "Форвард хеликс",
    };
    return map[type] ?? type;
}
