"use client";

import { use, useState } from "react";
import Link from "next/link";
import styles from "../../admin.module.css";
import {
    mockClients,
    mockAppointments,
    mockReservations,
    STATUS_LABELS,
    RES_STATUS_LABELS,
    type AppointmentStatus,
    type ReservationStatus,
} from "@/lib/admin-data";

function aptStatusClass(s: AppointmentStatus) {
    const map: Record<AppointmentStatus, string> = {
        pending: styles.badgePending,
        confirmed: styles.badgeConfirmed,
        completed: styles.badgeCompleted,
        cancelled: styles.badgeCancelled,
        no_show: styles.badgeNoShow,
    };
    return map[s];
}

function resStatusClass(s: ReservationStatus) {
    const map: Record<ReservationStatus, string> = {
        pending: styles.badgePending,
        confirmed: styles.badgeConfirmed,
        picked_up: styles.badgePickedUp,
        expired: styles.badgeExpired,
        cancelled: styles.badgeCancelled,
    };
    return map[s];
}

export default function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const client = mockClients.find((c) => c.id === id) ?? mockClients[0];
    const [notes, setNotes] = useState(client.notes);
    const [tab, setTab] = useState(0);

    const clientApts = mockAppointments.filter(
        (a) => a.clientName === `${client.firstName} ${client.lastName}`
    );
    const clientRes = mockReservations.filter(
        (r) => r.customerName === `${client.firstName} ${client.lastName}`
    );

    const age = client.dateOfBirth
        ? new Date().getFullYear() - new Date(client.dateOfBirth).getFullYear()
        : null;

    return (
        <>
            <Link href="/admin/clients" className={styles.backLink}>
                ← Клиенты
            </Link>

            <div className={styles.pageHeader}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    <div
                        style={{
                            width: 52,
                            height: 52,
                            borderRadius: "50%",
                            background: "var(--adm-magenta-tint)",
                            color: "var(--adm-magenta)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontFamily: "var(--font-display-new)",
                            fontSize: "1.1rem",
                            fontWeight: 700,
                            flexShrink: 0,
                        }}
                    >
                        {client.firstName[0]}
                        {client.lastName[0]}
                    </div>
                    <div>
                        <h1 className={styles.pageHeading}>
                            {client.firstName} {client.lastName}
                        </h1>
                        <span className={styles.pageDesc}>
                            Клиент с{" "}
                            {new Date(client.createdAt).toLocaleDateString("ru", {
                                month: "long",
                                year: "numeric",
                            })}
                            {age ? ` · ${age} лет` : ""}
                        </span>
                    </div>
                </div>
                <div className={styles.headerActions}>
                    <a
                        href={`tel:${client.phone.replace(/[^+\d]/g, "")}`}
                        className={`${styles.btn} ${styles.btnSecondary}`}
                    >
                        📞 Позвонить
                    </a>
                </div>
            </div>

            {/* Stats */}
            <div
                className={styles.statsRow}
                style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: 22 }}
            >
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Всего записей</span>
                    <span className={styles.statValue}>{client.totalAppointments}</span>
                </div>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Всего броней</span>
                    <span className={styles.statValue}>{client.totalReservations}</span>
                </div>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Последний визит</span>
                    <span className={styles.statValue} style={{ fontSize: "1.1rem" }}>
                        {client.lastVisit
                            ? new Date(client.lastVisit).toLocaleDateString("ru", {
                                  day: "2-digit",
                                  month: "short",
                              })
                            : "—"}
                    </span>
                </div>
            </div>

            <div className={styles.detailLayout}>
                {/* Main */}
                <div className={styles.detailMain}>
                    <div className={styles.tabs}>
                        <div className={styles.tabList}>
                            {["Записи", "Брони", "Заметки"].map((t, i) => (
                                <button
                                    key={t}
                                    className={`${styles.tabBtn} ${tab === i ? styles.tabBtnActive : ""}`}
                                    onClick={() => setTab(i)}
                                >
                                    {t}
                                    {i === 0 && clientApts.length > 0 && (
                                        <span
                                            className={styles.chip}
                                            style={{ marginLeft: 6, padding: "1px 6px" }}
                                        >
                                            {clientApts.length}
                                        </span>
                                    )}
                                    {i === 1 && clientRes.length > 0 && (
                                        <span
                                            className={styles.chip}
                                            style={{ marginLeft: 6, padding: "1px 6px" }}
                                        >
                                            {clientRes.length}
                                        </span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </div>

                    {tab === 0 && (
                        <div className={styles.card}>
                            <div className={styles.tableWrap}>
                                <table className={styles.table}>
                                    <thead className={styles.tHead}>
                                        <tr>
                                            <th>Услуга</th>
                                            <th>Дата</th>
                                            <th>Время</th>
                                            <th>Сумма</th>
                                            <th>Статус</th>
                                        </tr>
                                    </thead>
                                    <tbody className={styles.tBody}>
                                        {clientApts.length === 0 ? (
                                            <tr>
                                                <td colSpan={5}>
                                                    <div className={styles.emptyState}>
                                                        <p className={styles.emptyTitle}>
                                                            Записей нет
                                                        </p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            clientApts.map((a) => (
                                                <tr key={a.id}>
                                                    <td className={styles.td}>{a.service}</td>
                                                    <td className={`${styles.td} ${styles.tdMono}`}>
                                                        {new Date(a.date).toLocaleDateString("ru", {
                                                            day: "2-digit",
                                                            month: "short",
                                                        })}
                                                    </td>
                                                    <td className={`${styles.td} ${styles.tdMono}`}>
                                                        {a.timeStart}
                                                    </td>
                                                    <td className={`${styles.td} ${styles.tdMono}`}>
                                                        {a.totalPrice.toLocaleString("ru")} ₽
                                                    </td>
                                                    <td className={styles.td}>
                                                        <span
                                                            className={`${styles.badge} ${aptStatusClass(a.status)}`}
                                                        >
                                                            {STATUS_LABELS[a.status]}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {tab === 1 && (
                        <div className={styles.card}>
                            <div className={styles.tableWrap}>
                                <table className={styles.table}>
                                    <thead className={styles.tHead}>
                                        <tr>
                                            <th>Номер</th>
                                            <th>Позиции</th>
                                            <th>Сумма</th>
                                            <th>Статус</th>
                                        </tr>
                                    </thead>
                                    <tbody className={styles.tBody}>
                                        {clientRes.length === 0 ? (
                                            <tr>
                                                <td colSpan={4}>
                                                    <div className={styles.emptyState}>
                                                        <p className={styles.emptyTitle}>
                                                            Броней нет
                                                        </p>
                                                    </div>
                                                </td>
                                            </tr>
                                        ) : (
                                            clientRes.map((r) => (
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
                                                    <td className={`${styles.td} ${styles.tdMono}`}>
                                                        {r.items.length} поз.
                                                    </td>
                                                    <td className={`${styles.td} ${styles.tdMono}`}>
                                                        {r.total.toLocaleString("ru")} ₽
                                                    </td>
                                                    <td className={styles.td}>
                                                        <span
                                                            className={`${styles.badge} ${resStatusClass(r.status)}`}
                                                        >
                                                            {RES_STATUS_LABELS[r.status]}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {tab === 2 && (
                        <div className={styles.card}>
                            <div className={styles.cardHeader}>
                                <h2 className={styles.cardTitle}>Заметки мастера</h2>
                            </div>
                            <div className={styles.cardBody}>
                                <textarea
                                    className={styles.formTextarea}
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    placeholder="Предпочтения клиента, важные пометки..."
                                    style={{ minHeight: 160 }}
                                />
                                <div style={{ marginTop: 12 }}>
                                    <button className={`${styles.btn} ${styles.btnPrimary}`}>
                                        Сохранить
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Side */}
                <div className={styles.detailSide}>
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Контактные данные</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <ul className={styles.infoList}>
                                <li className={styles.infoRow}>
                                    <span className={styles.infoLabel}>Телефон</span>
                                    <span className={styles.infoValue}>{client.phone}</span>
                                </li>
                                <li className={styles.infoRow}>
                                    <span className={styles.infoLabel}>Email</span>
                                    <span
                                        className={`${styles.infoValue} ${styles.tdMono}`}
                                        style={{ fontSize: "0.75rem", wordBreak: "break-all" }}
                                    >
                                        {client.email}
                                    </span>
                                </li>
                                {client.dateOfBirth && (
                                    <li className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Дата рождения</span>
                                        <span className={`${styles.infoValue} ${styles.tdMono}`}>
                                            {new Date(client.dateOfBirth).toLocaleDateString("ru", {
                                                day: "2-digit",
                                                month: "long",
                                                year: "numeric",
                                            })}
                                        </span>
                                    </li>
                                )}
                                {client.allergies && (
                                    <li className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Аллергии</span>
                                        <span
                                            className={styles.infoValue}
                                            style={{ color: "var(--adm-danger)" }}
                                        >
                                            ⚠ {client.allergies}
                                        </span>
                                    </li>
                                )}
                                <li className={styles.infoRow}>
                                    <span className={styles.infoLabel}>Зарегистрирован</span>
                                    <span className={`${styles.infoValue} ${styles.tdMono}`}>
                                        {new Date(client.createdAt).toLocaleDateString("ru", {
                                            day: "2-digit",
                                            month: "long",
                                            year: "numeric",
                                        })}
                                    </span>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
