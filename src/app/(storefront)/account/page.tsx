import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { auth } from "@/lib/auth";
import {
    db,
    appointments,
    reservations,
    notificationLogs,
    appointmentServices,
    services,
} from "@/db";

import styles from "./dashboard.module.css";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function AccountDashboardPage() {
    const session = await auth();
    const customerId = session!.user!.customerId!;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Fetch up to 3 upcoming appointments
    const upcomingAppointments = await db
        .select({
            id: appointments.id,
            referenceNumber: appointments.referenceNumber,
            date: appointments.date,
            timeStart: appointments.timeStart,
            status: appointments.status,
        })
        .from(appointments)
        .where(
            and(
                eq(appointments.customerId, customerId),
                gte(appointments.date, new Date().toISOString().split("T")[0]),
                inArray(appointments.status, ["pending", "confirmed"])
            )
        )
        .orderBy(appointments.date, appointments.timeStart)
        .limit(3);

    // Fetch service names for appointments
    const appointmentIds = upcomingAppointments.map((a) => a.id);
    let appointmentServiceNames: Record<string, string[]> = {};
    if (appointmentIds.length > 0) {
        const svcRows = await db
            .select({
                appointmentId: appointmentServices.appointmentId,
                serviceName: services.name,
            })
            .from(appointmentServices)
            .innerJoin(services, eq(appointmentServices.serviceId, services.id))
            .where(inArray(appointmentServices.appointmentId, appointmentIds));

        appointmentServiceNames = svcRows.reduce(
            (acc, row) => {
                if (!acc[row.appointmentId]) acc[row.appointmentId] = [];
                acc[row.appointmentId].push(row.serviceName);
                return acc;
            },
            {} as Record<string, string[]>
        );
    }

    // Fetch up to 3 active reservations
    const activeReservations = await db
        .select({
            id: reservations.id,
            referenceNumber: reservations.referenceNumber,
            status: reservations.status,
            total: reservations.total,
            expiresAt: reservations.expiresAt,
        })
        .from(reservations)
        .where(
            and(
                eq(reservations.customerId, customerId),
                inArray(reservations.status, ["pending", "confirmed"])
            )
        )
        .orderBy(desc(reservations.createdAt))
        .limit(3);

    // Fetch up to 5 notifications from last 30 days
    const recentNotifications = await db
        .select({
            id: notificationLogs.id,
            type: notificationLogs.type,
            subject: notificationLogs.subject,
            sentAt: notificationLogs.sentAt,
            status: notificationLogs.status,
            metadata: notificationLogs.metadata,
        })
        .from(notificationLogs)
        .where(
            and(
                eq(notificationLogs.customerId, customerId),
                gte(notificationLogs.sentAt, thirtyDaysAgo)
            )
        )
        .orderBy(desc(notificationLogs.sentAt))
        .limit(5);

    return (
        <div className={styles.dashboard}>
            <h1 className={styles.pageTitle}>Обзор</h1>

            {/* Upcoming Appointments */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Ближайшие записи</h2>
                    <Link href="/account/appointments" className={styles.sectionLink}>
                        Все записи →
                    </Link>
                </div>
                {upcomingAppointments.length === 0 ? (
                    <div className={styles.emptyState}>
                        <p className={styles.emptyText}>У вас нет предстоящих записей</p>
                        <Link href="/booking" className={styles.ctaLink}>
                            Записаться на приём
                        </Link>
                    </div>
                ) : (
                    <ul className={styles.cardList}>
                        {upcomingAppointments.map((apt) => (
                            <li key={apt.id} className={styles.card}>
                                <div className={styles.cardTop}>
                                    <span className={styles.cardDate}>
                                        {formatDate(apt.date)} в {apt.timeStart?.slice(0, 5)}
                                    </span>
                                    <span className={styles.statusBadge} data-status={apt.status}>
                                        {statusLabel(apt.status)}
                                    </span>
                                </div>
                                <p className={styles.cardService}>
                                    {appointmentServiceNames[apt.id]?.join(", ") || "—"}
                                </p>
                                <span className={styles.cardRef}>{apt.referenceNumber}</span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* Active Reservations */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Активные брони</h2>
                    <Link href="/account/reservations" className={styles.sectionLink}>
                        Все брони →
                    </Link>
                </div>
                {activeReservations.length === 0 ? (
                    <div className={styles.emptyState}>
                        <p className={styles.emptyText}>У вас нет активных броней</p>
                        <Link href="/catalog" className={styles.ctaLink}>
                            Перейти в каталог
                        </Link>
                    </div>
                ) : (
                    <ul className={styles.cardList}>
                        {activeReservations.map((res) => (
                            <li key={res.id} className={styles.card}>
                                <div className={styles.cardTop}>
                                    <span className={styles.cardRef}>{res.referenceNumber}</span>
                                    <span className={styles.statusBadge} data-status={res.status}>
                                        {reservationStatusLabel(res.status)}
                                    </span>
                                </div>
                                <p className={styles.cardPrice}>{formatPrice(res.total)}</p>
                                {res.expiresAt && (
                                    <span className={styles.cardMeta}>
                                        Истекает: {formatDateTime(res.expiresAt)}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {/* Recent Notifications */}
            <section className={styles.section}>
                <div className={styles.sectionHeader}>
                    <h2 className={styles.sectionTitle}>Уведомления</h2>
                    <Link href="/account/notifications" className={styles.sectionLink}>
                        Все уведомления →
                    </Link>
                </div>
                {recentNotifications.length === 0 ? (
                    <div className={styles.emptyState}>
                        <p className={styles.emptyText}>Нет уведомлений за последние 30 дней</p>
                    </div>
                ) : (
                    <ul className={styles.notifList}>
                        {recentNotifications.map((notif) => (
                            <li key={notif.id} className={styles.notifItem}>
                                <span className={styles.notifTitle}>
                                    {notif.subject || notificationTypeLabel(notif.type)}
                                </span>
                                <span className={styles.notifTime}>
                                    {notif.sentAt ? formatDateTime(notif.sentAt) : "—"}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

// ── Helpers ──

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr + "T00:00:00+03:00");
    return d.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
        timeZone: "Europe/Moscow",
    });
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

function formatPrice(kopecks: number): string {
    return `${(kopecks / 100).toLocaleString("ru-RU")} ₽`;
}

function statusLabel(status: string | null): string {
    const map: Record<string, string> = {
        pending: "Ожидает",
        confirmed: "Подтверждена",
        completed: "Завершена",
        cancelled: "Отменена",
        no_show: "Неявка",
    };
    return map[status ?? ""] ?? status ?? "—";
}

function reservationStatusLabel(status: string | null): string {
    const map: Record<string, string> = {
        pending: "Ожидает",
        confirmed: "Подтверждена",
        picked_up: "Получена",
        cancelled: "Отменена",
        expired: "Истекла",
    };
    return map[status ?? ""] ?? status ?? "—";
}

function notificationTypeLabel(type: string): string {
    const map: Record<string, string> = {
        reservation_confirmation: "Подтверждение брони",
        booking_reminder: "Напоминание о записи",
        aftercare: "Уход за пирсингом",
        booking_confirmation: "Подтверждение записи",
        satisfaction_survey: "Опрос",
    };
    return map[type] ?? type;
}
