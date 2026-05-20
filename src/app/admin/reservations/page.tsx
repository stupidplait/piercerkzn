"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
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

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("ru", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatExpiry(expiresAt: string) {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return <span className={styles.textDanger}>истекла</span>;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const label = h > 0 ? `${h}ч ${m}м` : `${m}м`;
    const urgent = diff < 3 * 3600000;
    return <span className={urgent ? styles.textDanger : ""}>{label}</span>;
}

export default function ReservationsPage() {
    const [statusFilter, setStatusFilter] = useState("");
    const [search, setSearch] = useState("");

    const filtered = mockReservations.filter((r) => {
        const matchStatus = !statusFilter || r.status === statusFilter;
        const matchSearch =
            !search ||
            r.customerName.toLowerCase().includes(search.toLowerCase()) ||
            r.referenceNumber.toLowerCase().includes(search.toLowerCase());
        return matchStatus && matchSearch;
    });

    return (
        <>
            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>Брони</h1>
                    <span className={styles.pageDesc}>
                        {
                            mockReservations.filter(
                                (r) => r.status === "pending" || r.status === "confirmed"
                            ).length
                        }{" "}
                        активных
                    </span>
                </div>
            </div>

            <div className={styles.filterBar}>
                <div className={styles.searchWrap}>
                    <svg
                        className={styles.searchIcon}
                        viewBox="0 0 14 14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                    >
                        <circle cx="6" cy="6" r="4" />
                        <line x1="9.5" y1="9.5" x2="13" y2="13" />
                    </svg>
                    <input
                        type="text"
                        className={styles.searchInput}
                        placeholder="Поиск по клиенту или номеру..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <select
                    className={styles.filterSelect}
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                >
                    <option value="">Все статусы</option>
                    <option value="pending">Ожидает</option>
                    <option value="confirmed">Подтверждена</option>
                    <option value="picked_up">Забрано</option>
                    <option value="expired">Истекла</option>
                    <option value="cancelled">Отменена</option>
                </select>
            </div>

            <div className={styles.card}>
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead className={styles.tHead}>
                            <tr>
                                <th>Номер</th>
                                <th>Клиент</th>
                                <th>Позиции</th>
                                <th>Сумма</th>
                                <th>Создана</th>
                                <th>Истекает</th>
                                <th>Статус</th>
                                <th style={{ textAlign: "right", paddingRight: 22 }}>Действия</th>
                            </tr>
                        </thead>
                        <tbody className={styles.tBody}>
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <div className={styles.emptyState}>
                                            <div className={styles.emptyIcon}>📋</div>
                                            <p className={styles.emptyTitle}>Броней нет</p>
                                            <p className={styles.emptyText}>
                                                Брони появятся здесь после создания
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((r) => (
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
                                        <td className={styles.td}>
                                            <div style={{ fontWeight: 500 }}>{r.customerName}</div>
                                            <div className={styles.tdMono}>{r.customerPhone}</div>
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {r.items.length} поз.
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {r.total.toLocaleString("ru")} ₽
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {formatDate(r.createdAt)}
                                        </td>
                                        <td className={styles.td}>{formatExpiry(r.expiresAt)}</td>
                                        <td className={styles.td}>
                                            <span
                                                className={`${styles.badge} ${statusClass(r.status)}`}
                                            >
                                                {RES_STATUS_LABELS[r.status]}
                                            </span>
                                        </td>
                                        <td className={styles.td}>
                                            <div className={styles.tdActions}>
                                                <Link
                                                    href={`/admin/reservations/${r.id}`}
                                                    className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                                >
                                                    Открыть
                                                </Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </>
    );
}
