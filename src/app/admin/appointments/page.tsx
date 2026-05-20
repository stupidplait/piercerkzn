"use client";

import { useState } from "react";
import styles from "../admin.module.css";
import { mockAppointments, STATUS_LABELS, type AppointmentStatus } from "@/lib/admin-data";

const WEEK_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const WEEK_DATES = ["14", "15", "16", "17", "18", "19", "20"];
const WEEK_FULL = [
    "2025-07-14",
    "2025-07-15",
    "2025-07-16",
    "2025-07-17",
    "2025-07-18",
    "2025-07-19",
    "2025-07-20",
];
const TODAY = "2025-07-14";

function statusClass(s: AppointmentStatus) {
    const map: Record<AppointmentStatus, string> = {
        pending: styles.badgePending,
        confirmed: styles.badgeConfirmed,
        completed: styles.badgeCompleted,
        cancelled: styles.badgeCancelled,
        no_show: styles.badgeNoShow,
    };
    return map[s];
}

function calEventClass(s: AppointmentStatus) {
    if (s === "completed") return styles.calEventGreen;
    if (s === "cancelled" || s === "no_show") return styles.calEventGray;
    return styles.calEventMagenta;
}

export default function AppointmentsPage() {
    const [view, setView] = useState<"calendar" | "list">("calendar");
    const [statusFilter, setStatusFilter] = useState("");
    const [selected, setSelected] = useState<string | null>(null);

    const selectedApt = selected ? mockAppointments.find((a) => a.id === selected) : null;

    const filtered = mockAppointments.filter((a) => !statusFilter || a.status === statusFilter);

    return (
        <>
            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>Записи</h1>
                    <span className={styles.pageDesc}>Неделя 14–20 июля 2025</span>
                </div>
                <div className={styles.headerActions}>
                    <div
                        style={{
                            display: "flex",
                            gap: 2,
                            border: "1px solid var(--adm-rule)",
                            borderRadius: 4,
                            overflow: "hidden",
                        }}
                    >
                        {(["calendar", "list"] as const).map((v) => (
                            <button
                                key={v}
                                onClick={() => setView(v)}
                                className={`${styles.btn} ${view === v ? styles.btnPrimary : styles.btnGhost}`}
                                style={{ borderRadius: 0, border: "none" }}
                            >
                                {v === "calendar" ? "Календарь" : "Список"}
                            </button>
                        ))}
                    </div>
                    <button className={`${styles.btn} ${styles.btnPrimary}`}>
                        + Создать запись
                    </button>
                </div>
            </div>

            {view === "calendar" && (
                <div className={styles.card}>
                    <div className={styles.cardBody} style={{ padding: 0 }}>
                        <div className={styles.calWrap}>
                            {/* Header */}
                            <div className={styles.calHeader7}>
                                {WEEK_DAYS.map((d, i) => (
                                    <div key={d} style={{ padding: "8px 4px" }}>
                                        <div>{d}</div>
                                        <div
                                            style={{
                                                fontWeight: WEEK_FULL[i] === TODAY ? 700 : 400,
                                                color:
                                                    WEEK_FULL[i] === TODAY
                                                        ? "var(--adm-magenta)"
                                                        : "inherit",
                                            }}
                                        >
                                            {WEEK_DATES[i]}
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Body */}
                            <div className={styles.calBody7}>
                                {WEEK_FULL.map((date) => {
                                    const dayApts = mockAppointments.filter((a) => a.date === date);
                                    return (
                                        <div key={date} className={styles.calDayCol}>
                                            {dayApts.map((apt) => (
                                                <div
                                                    key={apt.id}
                                                    className={`${styles.calEvent} ${calEventClass(apt.status)}`}
                                                    onClick={() =>
                                                        setSelected(
                                                            apt.id === selected ? null : apt.id
                                                        )
                                                    }
                                                    title={`${apt.clientName} · ${apt.service}`}
                                                >
                                                    {apt.timeStart} {apt.clientName.split(" ")[0]}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {view === "list" && (
                <>
                    <div className={styles.filterBar}>
                        <select
                            className={styles.filterSelect}
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                        >
                            <option value="">Все статусы</option>
                            <option value="pending">Ожидает</option>
                            <option value="confirmed">Подтверждена</option>
                            <option value="completed">Завершена</option>
                            <option value="cancelled">Отменена</option>
                        </select>
                    </div>

                    <div className={styles.card}>
                        <div className={styles.tableWrap}>
                            <table className={styles.table}>
                                <thead className={styles.tHead}>
                                    <tr>
                                        <th>Клиент</th>
                                        <th>Услуга</th>
                                        <th>Дата</th>
                                        <th>Время</th>
                                        <th>Длит.</th>
                                        <th>Сумма</th>
                                        <th>Вейвер</th>
                                        <th>Статус</th>
                                    </tr>
                                </thead>
                                <tbody className={styles.tBody}>
                                    {filtered.map((apt) => (
                                        <tr
                                            key={apt.id}
                                            style={{ cursor: "pointer" }}
                                            onClick={() =>
                                                setSelected(apt.id === selected ? null : apt.id)
                                            }
                                        >
                                            <td className={styles.td}>
                                                <div style={{ fontWeight: 500 }}>
                                                    {apt.clientName}
                                                </div>
                                                <div className={styles.tdMono}>
                                                    {apt.clientPhone}
                                                </div>
                                            </td>
                                            <td className={`${styles.td}`}>{apt.service}</td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {new Date(apt.date).toLocaleDateString("ru", {
                                                    day: "2-digit",
                                                    month: "short",
                                                })}
                                            </td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {apt.timeStart}–{apt.timeEnd}
                                            </td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {apt.durationMin} мин
                                            </td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {apt.totalPrice.toLocaleString("ru")} ₽
                                            </td>
                                            <td className={styles.td}>
                                                <span
                                                    style={{
                                                        color: apt.waiverSigned
                                                            ? "var(--adm-success)"
                                                            : "var(--adm-danger)",
                                                        fontSize: "1rem",
                                                    }}
                                                >
                                                    {apt.waiverSigned ? "✓" : "✕"}
                                                </span>
                                            </td>
                                            <td className={styles.td}>
                                                <span
                                                    className={`${styles.badge} ${statusClass(apt.status)}`}
                                                >
                                                    {STATUS_LABELS[apt.status]}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* Detail panel */}
            {selectedApt && (
                <div className={styles.card} style={{ marginTop: 20 }}>
                    <div className={styles.cardHeader}>
                        <h2 className={styles.cardTitle}>
                            {selectedApt.clientName} · {selectedApt.service}
                        </h2>
                        <button className={styles.btnGhost} onClick={() => setSelected(null)}>
                            ✕
                        </button>
                    </div>
                    <div className={styles.cardBody}>
                        <div className={styles.detailLayout}>
                            <div className={styles.detailMain}>
                                <ul className={styles.infoList}>
                                    <li className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Услуга</span>
                                        <span className={styles.infoValue}>
                                            {selectedApt.service}
                                        </span>
                                    </li>
                                    <li className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Дата и время</span>
                                        <span className={`${styles.infoValue} ${styles.tdMono}`}>
                                            {new Date(selectedApt.date).toLocaleDateString("ru", {
                                                day: "2-digit",
                                                month: "long",
                                            })}{" "}
                                            · {selectedApt.timeStart}–{selectedApt.timeEnd}
                                        </span>
                                    </li>
                                    <li className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Продолжительность</span>
                                        <span className={`${styles.infoValue} ${styles.tdMono}`}>
                                            {selectedApt.durationMin} мин
                                        </span>
                                    </li>
                                    <li className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Стоимость</span>
                                        <span className={`${styles.infoValue} ${styles.tdMono}`}>
                                            {selectedApt.totalPrice.toLocaleString("ru")} ₽
                                        </span>
                                    </li>
                                    <li className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Вейвер</span>
                                        <span
                                            className={styles.infoValue}
                                            style={{
                                                color: selectedApt.waiverSigned
                                                    ? "var(--adm-success)"
                                                    : "var(--adm-danger)",
                                            }}
                                        >
                                            {selectedApt.waiverSigned ? "Подписан" : "Не подписан"}
                                        </span>
                                    </li>
                                    {selectedApt.notes && (
                                        <li className={styles.infoRow}>
                                            <span className={styles.infoLabel}>Заметки</span>
                                            <span className={styles.infoValue}>
                                                {selectedApt.notes}
                                            </span>
                                        </li>
                                    )}
                                </ul>
                            </div>
                            <div className={styles.detailSide}>
                                <div className={styles.formGroup} style={{ marginBottom: 16 }}>
                                    <label className={styles.formLabel}>Статус записи</label>
                                    <select
                                        className={styles.formSelect}
                                        defaultValue={selectedApt.status}
                                    >
                                        <option value="pending">Ожидает</option>
                                        <option value="confirmed">Подтверждена</option>
                                        <option value="completed">Завершена</option>
                                        <option value="cancelled">Отменена</option>
                                        <option value="no_show">Не пришёл</option>
                                    </select>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    <button
                                        className={`${styles.btn} ${styles.btnPrimary}`}
                                        style={{ justifyContent: "center" }}
                                    >
                                        Сохранить статус
                                    </button>
                                    <button
                                        className={`${styles.btn} ${styles.btnSecondary}`}
                                        style={{ justifyContent: "center" }}
                                    >
                                        Перенести
                                    </button>
                                    <button
                                        className={`${styles.btn} ${styles.btnDanger}`}
                                        style={{ justifyContent: "center" }}
                                    >
                                        Отменить запись
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
