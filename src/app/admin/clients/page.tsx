"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "../admin.module.css";
import { mockClients } from "@/lib/admin-data";

export default function ClientsPage() {
    const [search, setSearch] = useState("");

    const filtered = mockClients.filter((c) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
            c.firstName.toLowerCase().includes(q) ||
            c.lastName.toLowerCase().includes(q) ||
            c.phone.includes(q) ||
            c.email.toLowerCase().includes(q)
        );
    });

    return (
        <>
            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>Клиенты</h1>
                    <span className={styles.pageDesc}>{mockClients.length} зарегистрированных</span>
                </div>
                <div className={styles.headerActions}>
                    <button className={`${styles.btn} ${styles.btnSecondary}`}>Экспорт CSV</button>
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
                        placeholder="Поиск по имени, телефону или email..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className={styles.card}>
                <div className={styles.tableWrap}>
                    <table className={styles.table}>
                        <thead className={styles.tHead}>
                            <tr>
                                <th>Клиент</th>
                                <th>Телефон</th>
                                <th>Email</th>
                                <th>Записей</th>
                                <th>Броней</th>
                                <th>Последний визит</th>
                                <th>Регистрация</th>
                                <th style={{ textAlign: "right", paddingRight: 22 }}>Действия</th>
                            </tr>
                        </thead>
                        <tbody className={styles.tBody}>
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={8}>
                                        <div className={styles.emptyState}>
                                            <div className={styles.emptyIcon}>👤</div>
                                            <p className={styles.emptyTitle}>Клиенты не найдены</p>
                                            <p className={styles.emptyText}>
                                                Попробуйте изменить запрос поиска
                                            </p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filtered.map((c) => (
                                    <tr key={c.id}>
                                        <td className={styles.td}>
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 10,
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        width: 32,
                                                        height: 32,
                                                        borderRadius: "50%",
                                                        background: "var(--adm-magenta-tint)",
                                                        color: "var(--adm-magenta)",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        fontFamily: "var(--font-mono)",
                                                        fontSize: "0.7rem",
                                                        fontWeight: 600,
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    {c.firstName[0]}
                                                    {c.lastName[0]}
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: 500 }}>
                                                        {c.firstName} {c.lastName}
                                                    </div>
                                                    {c.allergies && (
                                                        <div
                                                            className={styles.tdMono}
                                                            style={{
                                                                color: "var(--adm-danger)",
                                                                marginTop: 1,
                                                            }}
                                                        >
                                                            ⚠ {c.allergies}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {c.phone}
                                        </td>
                                        <td
                                            className={`${styles.td} ${styles.tdMono}`}
                                            style={{ fontSize: "0.72rem" }}
                                        >
                                            {c.email}
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {c.totalAppointments}
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {c.totalReservations}
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {c.lastVisit
                                                ? new Date(c.lastVisit).toLocaleDateString("ru", {
                                                      day: "2-digit",
                                                      month: "short",
                                                  })
                                                : "—"}
                                        </td>
                                        <td className={`${styles.td} ${styles.tdMono}`}>
                                            {new Date(c.createdAt).toLocaleDateString("ru", {
                                                day: "2-digit",
                                                month: "short",
                                                year: "2-digit",
                                            })}
                                        </td>
                                        <td className={styles.td}>
                                            <div className={styles.tdActions}>
                                                <Link
                                                    href={`/admin/clients/${c.id}`}
                                                    className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}
                                                >
                                                    Профиль
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
