import { desc, eq } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { db, notificationLogs } from "@/db";

import { MarkAsReadButton } from "./_components/MarkAsReadButton";
import styles from "./notifications.module.css";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
    const session = await auth();
    const customerId = session!.user!.customerId!;

    const notifications = await db
        .select({
            id: notificationLogs.id,
            type: notificationLogs.type,
            subject: notificationLogs.subject,
            contentPreview: notificationLogs.contentPreview,
            status: notificationLogs.status,
            sentAt: notificationLogs.sentAt,
            metadata: notificationLogs.metadata,
        })
        .from(notificationLogs)
        .where(eq(notificationLogs.customerId, customerId))
        .orderBy(desc(notificationLogs.sentAt))
        .limit(50);

    return (
        <div className={styles.page}>
            <h1 className={styles.pageTitle}>Уведомления</h1>

            {notifications.length === 0 ? (
                <div className={styles.emptyState}>
                    <p className={styles.emptyText}>У вас пока нет уведомлений</p>
                </div>
            ) : (
                <ul className={styles.list}>
                    {notifications.map((notif) => {
                        const isRead = isNotificationRead(notif.metadata);
                        return (
                            <li
                                key={notif.id}
                                className={styles.item}
                                data-read={isRead ? "1" : "0"}
                            >
                                <div className={styles.itemContent}>
                                    {!isRead && <span className={styles.unreadDot} />}
                                    <div className={styles.itemText}>
                                        <span className={styles.itemTitle}>
                                            {notif.subject || notificationTypeLabel(notif.type)}
                                        </span>
                                        {notif.contentPreview && (
                                            <span className={styles.itemPreview}>
                                                {notif.contentPreview.slice(0, 100)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className={styles.itemMeta}>
                                    <span className={styles.itemTime}>
                                        {notif.sentAt ? formatDateTime(notif.sentAt) : "—"}
                                    </span>
                                    {!isRead && <MarkAsReadButton notificationId={notif.id} />}
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

function isNotificationRead(metadata: unknown): boolean {
    if (!metadata || typeof metadata !== "object") return false;
    return (metadata as Record<string, unknown>).read === true;
}

function formatDateTime(date: Date): string {
    return date.toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Moscow",
    });
}

function notificationTypeLabel(type: string): string {
    const map: Record<string, string> = {
        reservation_confirmation: "Подтверждение брони",
        booking_reminder: "Напоминание о записи",
        booking_confirmation: "Подтверждение записи",
        aftercare: "Уход за пирсингом",
        satisfaction_survey: "Опрос удовлетворённости",
        reservation_expiring: "Бронь истекает",
        downsize_reminder: "Напоминание о даунсайзе",
    };
    return map[type] ?? type;
}
