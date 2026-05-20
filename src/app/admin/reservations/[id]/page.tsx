"use client";

import { use, useState } from "react";
import Link from "next/link";
import styles from "../../admin.module.css";
import { mockReservations, RES_STATUS_LABELS, type ReservationStatus } from "@/lib/admin-data";

function statusClass(s: ReservationStatus) {
    const map: Record<ReservationStatus, string> = {
        pending: styles.badgePending,
        confirmed: styles.badgeConfirmed,
        picked_up: styles.badgePickedUp,
        expired: styles.badgeExpired,
        cancelled: styles.badgeCancelled,
    };
    return map[s];
}

function formatDateTime(iso: string) {
    return new Date(iso).toLocaleString("ru", {
        day: "2-digit",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatExpiry(expiresAt: string) {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "истекла";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return h > 0 ? `${h}ч ${m}м` : `${m}м`;
}

export default function ReservationDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = use(params);
    const reservation = mockReservations.find((r) => r.id === id) ?? mockReservations[0];
    const [status, setStatus] = useState<ReservationStatus>(reservation.status);
    const [note, setNote] = useState(reservation.notes);
    const [saved, setSaved] = useState(false);

    const handleAction = (newStatus: ReservationStatus) => {
        setStatus(newStatus);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    };

    const timelineEvents = [
        {
            icon: "✦",
            title: "Бронь создана",
            time: formatDateTime(reservation.createdAt),
            desc: `${reservation.items.length} позиц., ${reservation.total.toLocaleString("ru")} ₽`,
        },
        ...(status === "confirmed" || status === "picked_up"
            ? [
                  {
                      icon: "✓",
                      title: "Бронь подтверждена",
                      time: "вручную",
                      desc: "Мастер подтвердил бронь",
                  },
              ]
            : []),
        ...(status === "picked_up"
            ? [
                  {
                      icon: "★",
                      title: "Украшение выдано",
                      time: formatDateTime(reservation.expiresAt),
                      desc: "Клиент забрал украшение",
                  },
              ]
            : []),
        ...(status === "expired"
            ? [
                  {
                      icon: "✕",
                      title: "Бронь истекла",
                      time: formatDateTime(reservation.expiresAt),
                      desc: "Время резервирования истекло",
                  },
              ]
            : []),
        ...(status === "cancelled"
            ? [
                  {
                      icon: "✕",
                      title: "Бронь отменена",
                      time: "вручную",
                      desc: reservation.notes || "Отменено",
                  },
              ]
            : []),
    ];

    return (
        <>
            <Link href="/admin/reservations" className={styles.backLink}>
                ← Брони
            </Link>

            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>{reservation.referenceNumber}</h1>
                    <span className={styles.pageDesc}>
                        Создана: {formatDateTime(reservation.createdAt)}
                    </span>
                </div>
                <div className={styles.headerActions}>
                    <span
                        className={`${styles.badge} ${statusClass(status)}`}
                        style={{ padding: "6px 14px", fontSize: "0.7rem" }}
                    >
                        {RES_STATUS_LABELS[status]}
                    </span>
                    {saved && (
                        <span
                            className={`${styles.badge} ${styles.badgeCompleted}`}
                            style={{ padding: "6px 14px" }}
                        >
                            ✓ Сохранено
                        </span>
                    )}
                </div>
            </div>

            <div className={styles.detailLayout}>
                {/* Main */}
                <div className={styles.detailMain}>
                    {/* Items */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Забронированные украшения</h2>
                            <span className={styles.tdMono}>
                                {reservation.items.length} позиции
                            </span>
                        </div>
                        <div className={styles.tableWrap}>
                            <table className={styles.table}>
                                <thead className={styles.tHead}>
                                    <tr>
                                        <th>Украшение</th>
                                        <th>Вариант</th>
                                        <th>SKU</th>
                                        <th>Кол-во</th>
                                        <th>Цена</th>
                                        <th>Итого</th>
                                    </tr>
                                </thead>
                                <tbody className={styles.tBody}>
                                    {reservation.items.map((item) => (
                                        <tr key={item.id}>
                                            <td className={styles.td} style={{ fontWeight: 500 }}>
                                                {item.productTitle}
                                            </td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {item.variantTitle}
                                            </td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {item.sku}
                                            </td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {item.quantity}
                                            </td>
                                            <td className={`${styles.td} ${styles.tdMono}`}>
                                                {item.unitPrice.toLocaleString("ru")} ₽
                                            </td>
                                            <td
                                                className={`${styles.td} ${styles.tdMono}`}
                                                style={{ color: "var(--ink)" }}
                                            >
                                                {(item.unitPrice * item.quantity).toLocaleString(
                                                    "ru"
                                                )}{" "}
                                                ₽
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "flex-end",
                                padding: "12px 18px",
                                borderTop: "1px solid var(--adm-rule)",
                            }}
                        >
                            <span className={styles.tdMono} style={{ marginRight: 16 }}>
                                Итого
                            </span>
                            <span
                                style={{
                                    fontFamily: "var(--font-display-new)",
                                    fontSize: "1.1rem",
                                    fontWeight: 700,
                                }}
                            >
                                {reservation.total.toLocaleString("ru")} ₽
                            </span>
                        </div>
                    </div>

                    {/* Notes */}
                    <div className={styles.card} style={{ marginTop: 20 }}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Внутренние заметки</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <textarea
                                className={styles.formTextarea}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                placeholder="Заметки, видимые только мастеру..."
                            />
                        </div>
                    </div>

                    {/* Timeline */}
                    <div className={styles.card} style={{ marginTop: 20 }}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>История изменений</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.timeline}>
                                {timelineEvents.map((e, i) => (
                                    <div key={i} className={styles.timelineItem}>
                                        <div className={styles.timelineIcon}>{e.icon}</div>
                                        <div className={styles.timelineContent}>
                                            <span className={styles.timelineTitle}>{e.title}</span>
                                            <span className={styles.timelineTime}>{e.time}</span>
                                            {e.desc && (
                                                <span className={styles.timelineDesc}>
                                                    {e.desc}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Side */}
                <div className={styles.detailSide}>
                    {/* Customer */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Клиент</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <ul className={styles.infoList}>
                                <li className={styles.infoRow}>
                                    <span className={styles.infoLabel}>Имя</span>
                                    <span className={styles.infoValue}>
                                        {reservation.customerName}
                                    </span>
                                </li>
                                <li className={styles.infoRow}>
                                    <span className={styles.infoLabel}>Телефон</span>
                                    <span className={styles.infoValue}>
                                        {reservation.customerPhone}
                                    </span>
                                </li>
                                <li className={styles.infoRow}>
                                    <span className={styles.infoLabel}>Email</span>
                                    <span
                                        className={`${styles.infoValue} ${styles.tdMono}`}
                                        style={{ fontSize: "0.75rem" }}
                                    >
                                        {reservation.customerEmail}
                                    </span>
                                </li>
                            </ul>
                        </div>
                    </div>

                    {/* Expiry */}
                    <div className={styles.card} style={{ marginTop: 16 }}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Время брони</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <ul className={styles.infoList}>
                                <li className={styles.infoRow}>
                                    <span className={styles.infoLabel}>Создана</span>
                                    <span
                                        className={`${styles.infoValue} ${styles.tdMono}`}
                                        style={{ fontSize: "0.72rem" }}
                                    >
                                        {formatDateTime(reservation.createdAt)}
                                    </span>
                                </li>
                                <li className={styles.infoRow}>
                                    <span className={styles.infoLabel}>Истекает</span>
                                    <span
                                        className={`${styles.infoValue} ${styles.tdMono}`}
                                        style={{
                                            fontSize: "0.72rem",
                                            color:
                                                status === "pending" || status === "confirmed"
                                                    ? "var(--adm-warning)"
                                                    : "inherit",
                                        }}
                                    >
                                        {formatDateTime(reservation.expiresAt)}
                                    </span>
                                </li>
                                {(status === "pending" || status === "confirmed") && (
                                    <li className={styles.infoRow}>
                                        <span className={styles.infoLabel}>Осталось</span>
                                        <span
                                            className={styles.infoValue}
                                            style={{ color: "var(--adm-warning)", fontWeight: 600 }}
                                        >
                                            {formatExpiry(reservation.expiresAt)}
                                        </span>
                                    </li>
                                )}
                            </ul>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className={styles.card} style={{ marginTop: 16 }}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Действия</h2>
                        </div>
                        <div
                            className={styles.cardBody}
                            style={{ display: "flex", flexDirection: "column", gap: 8 }}
                        >
                            {status === "pending" && (
                                <button
                                    className={`${styles.btn} ${styles.btnPrimary}`}
                                    style={{ width: "100%", justifyContent: "center" }}
                                    onClick={() => handleAction("confirmed")}
                                >
                                    Подтвердить бронь
                                </button>
                            )}
                            {status === "confirmed" && (
                                <button
                                    className={`${styles.btn} ${styles.btnPrimary}`}
                                    style={{ width: "100%", justifyContent: "center" }}
                                    onClick={() => handleAction("picked_up")}
                                >
                                    Отметить как выдано
                                </button>
                            )}
                            {(status === "pending" || status === "confirmed") && (
                                <>
                                    <button
                                        className={`${styles.btn} ${styles.btnSecondary}`}
                                        style={{ width: "100%", justifyContent: "center" }}
                                        onClick={() => handleAction("pending")}
                                    >
                                        Продлить (+72ч)
                                    </button>
                                    <button
                                        className={`${styles.btn} ${styles.btnDanger}`}
                                        style={{ width: "100%", justifyContent: "center" }}
                                        onClick={() => handleAction("cancelled")}
                                    >
                                        Отменить бронь
                                    </button>
                                </>
                            )}
                            {(status === "expired" ||
                                status === "cancelled" ||
                                status === "picked_up") && (
                                <p className={`${styles.formHint}`} style={{ textAlign: "center" }}>
                                    Действия недоступны для статуса «{RES_STATUS_LABELS[status]}»
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
