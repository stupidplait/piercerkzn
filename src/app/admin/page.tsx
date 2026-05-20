"use client";

import Link from "next/link";
import styles from "./admin.module.css";
import {
    mockDashStats,
    mockAppointments,
    mockReservations,
    mockActivity,
    STATUS_LABELS,
    RES_STATUS_LABELS,
} from "@/lib/admin-data";

function statusClass(s: string) {
    const map: Record<string, string> = {
        pending: styles.badgePending,
        confirmed: styles.badgeConfirmed,
        completed: styles.badgeCompleted,
        cancelled: styles.badgeCancelled,
        expired: styles.badgeExpired,
        no_show: styles.badgeNoShow,
        picked_up: styles.badgePickedUp,
    };
    return map[s] ?? styles.badge;
}

function dotClass(c: string) {
    const map: Record<string, string> = {
        green: styles.dotGreen,
        amber: styles.dotAmber,
        magenta: styles.dotMagenta,
        gray: styles.dotGray,
    };
    return map[c] ?? styles.dotGray;
}

function formatExpiry(expiresAt: string): string {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "истекла";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h > 0) return `${h}ч ${m}м`;
    return `${m}м`;
}

const TODAY = "2025-07-14";

export default function AdminDashboard() {
    const todayAppts = mockAppointments.filter((a) => a.date === TODAY);
    const activeRes = mockReservations
        .filter((r) => r.status === "pending" || r.status === "confirmed")
        .slice(0, 5);

    return (
        <>
            {/* ── Page header ─────────────────── */}
            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>Панель управления</h1>
                    <span className={styles.pageDesc}>Понедельник · 14 июля 2025 · Казань</span>
                </div>
                <div className={styles.headerActions}>
                    <Link
                        href="/admin/reservations"
                        className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                    >
                        Все брони
                    </Link>
                    <Link
                        href="/admin/appointments"
                        className={`${styles.btn} ${styles.btnPrimary} ${styles.btnSm}`}
                    >
                        + Запись
                    </Link>
                </div>
            </div>

            {/* ── Stats row ───────────────────── */}
            <div className={styles.statsRow}>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Записей сегодня</span>
                    <span className={styles.statValue}>{mockDashStats.appointmentsToday}</span>
                    <span className={`${styles.statDelta} ${styles.statDeltaUp}`}>
                        {mockDashStats.appointmentsDelta}
                    </span>
                </div>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Активных броней</span>
                    <span className={styles.statValue}>{mockDashStats.activeReservations}</span>
                    <span className={`${styles.statDelta} ${styles.statDeltaUp}`}>
                        {mockDashStats.reservationsDelta}
                    </span>
                </div>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Позиций в каталоге</span>
                    <span className={styles.statValue}>{mockDashStats.catalogItems}</span>
                    <span className={styles.statDelta}>{mockDashStats.catalogDelta}</span>
                </div>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Всего клиентов</span>
                    <span className={styles.statValue}>{mockDashStats.totalClients}</span>
                    <span className={`${styles.statDelta} ${styles.statDeltaUp}`}>
                        {mockDashStats.clientsDelta}
                    </span>
                </div>
            </div>

            {/* ── Main dashboard grid ──────────── */}
            <div className={styles.dashGrid}>
                {/* Left column */}
                <div className={styles.dashMainCol}>
                    {/* Today's schedule */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Расписание на сегодня</h2>
                            <Link href="/admin/appointments" className={styles.cardAction}>
                                Смотреть всё →
                            </Link>
                        </div>
                        <div className={styles.cardBody}>
                            {todayAppts.length === 0 ? (
                                <div className={styles.emptyState}>
                                    <div className={styles.emptyIcon}>📅</div>
                                    <p className={styles.emptyTitle}>Записей нет</p>
                                    <p className={styles.emptyText}>
                                        На сегодня записей не запланировано
                                    </p>
                                </div>
                            ) : (
                                <div className={styles.scheduleList}>
                                    {todayAppts.map((apt) => (
                                        <div key={apt.id} className={styles.scheduleItem}>
                                            <span className={styles.scheduleTime}>
                                                {apt.timeStart}
                                            </span>
                                            <span className={styles.scheduleBar} />
                                            <div className={styles.scheduleInfo}>
                                                <span className={styles.scheduleClient}>
                                                    {apt.clientName}
                                                </span>
                                                <span className={styles.scheduleService}>
                                                    {apt.service} · {apt.durationMin} мин
                                                </span>
                                            </div>
                                            <span
                                                className={`${styles.badge} ${statusClass(apt.status)}`}
                                            >
                                                {STATUS_LABELS[apt.status]}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Active reservations */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Активные брони</h2>
                            <Link href="/admin/reservations" className={styles.cardAction}>
                                Смотреть всё →
                            </Link>
                        </div>
                        <div className={styles.tableWrap}>
                            <table className={styles.table}>
                                <thead className={styles.tHead}>
                                    <tr>
                                        <th>Номер</th>
                                        <th>Клиент</th>
                                        <th>Сумма</th>
                                        <th>Истекает</th>
                                        <th>Статус</th>
                                    </tr>
                                </thead>
                                <tbody className={styles.tBody}>
                                    {activeRes.map((r) => (
                                        <tr key={r.id}>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                <Link
                                                    href={`/admin/reservations/${r.id}`}
                                                    style={{
                                                        color: "var(--adm-magenta)",
                                                        textDecoration: "none",
                                                    }}
                                                >
                                                    {r.referenceNumber}
                                                </Link>
                                            </td>
                                            <td className={styles.td}>{r.customerName}</td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {r.total.toLocaleString("ru")} ₽
                                            </td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {formatExpiry(r.expiresAt)}
                                            </td>
                                            <td className={styles.td}>
                                                <span
                                                    className={`${styles.badge} ${statusClass(r.status)}`}
                                                >
                                                    {RES_STATUS_LABELS[r.status]}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* Right column */}
                <div className={styles.dashSideCol}>
                    {/* Quick actions */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Быстрые действия</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.quickActionsGrid}>
                                {[
                                    { icon: "💎", label: "Украшение", href: "/admin/products/new" },
                                    { icon: "📅", label: "Запись", href: "/admin/appointments" },
                                    { icon: "📋", label: "Брони", href: "/admin/reservations" },
                                    { icon: "👤", label: "Клиенты", href: "/admin/clients" },
                                    { icon: "✏️", label: "Статьи", href: "/admin/content" },
                                    { icon: "⚙️", label: "Настройки", href: "/admin/settings" },
                                ].map(({ icon, label, href }) => (
                                    <Link key={href} href={href} className={styles.quickActionBtn}>
                                        <span className={styles.quickActionIcon}>{icon}</span>
                                        <span className={styles.quickActionLabel}>{label}</span>
                                    </Link>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Alerts */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Оповещения</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.alertList}>
                                <div className={styles.alertItem}>
                                    <div
                                        className={`${styles.alertIcon} ${styles.alertIconDanger}`}
                                    >
                                        ⚠
                                    </div>
                                    <div>
                                        <p className={styles.alertTitle}>Малый остаток</p>
                                        <p className={styles.alertDesc}>
                                            Штанга изогнутая PVD — 2 шт.
                                        </p>
                                    </div>
                                </div>
                                <div className={styles.alertItem}>
                                    <div
                                        className={`${styles.alertIcon} ${styles.alertIconWarning}`}
                                    >
                                        🕐
                                    </div>
                                    <div>
                                        <p className={styles.alertTitle}>Бронь истекает</p>
                                        <p className={styles.alertDesc}>
                                            #PK-RES-2025-0041 — через 2ч 10м
                                        </p>
                                    </div>
                                </div>
                                <div className={styles.alertItem}>
                                    <div
                                        className={`${styles.alertIcon} ${styles.alertIconWarning}`}
                                    >
                                        📝
                                    </div>
                                    <div>
                                        <p className={styles.alertTitle}>Ожидает подтверждения</p>
                                        <p className={styles.alertDesc}>
                                            4 записи без подписанного вейвера
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Activity */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Последние события</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.activityList}>
                                {mockActivity.slice(0, 6).map((item) => (
                                    <div key={item.id} className={styles.activityItem}>
                                        <span
                                            className={`${styles.activityDot} ${dotClass(item.dotColor)}`}
                                        />
                                        <div>
                                            <p className={styles.activityText}>{item.text}</p>
                                            <p className={styles.activityMeta}>{item.time}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
