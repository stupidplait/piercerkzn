"use client";

import { useState } from "react";
import styles from "../admin.module.css";

const MONTHLY_DATA = [
    { label: "Янв", reservations: 12, appointments: 18 },
    { label: "Фев", reservations: 15, appointments: 22 },
    { label: "Мар", reservations: 19, appointments: 28 },
    { label: "Апр", reservations: 14, appointments: 20 },
    { label: "Май", reservations: 22, appointments: 31 },
    { label: "Июн", reservations: 28, appointments: 38 },
    { label: "Июл", reservations: 18, appointments: 24 },
];

const TOP_PRODUCTS = [
    { name: "Лабрет с радужным опалом", reservations: 14, pct: 90 },
    { name: "Кольцо сегментное 8мм", reservations: 11, pct: 71 },
    { name: "Нострил L-образный", reservations: 9, pct: 58 },
    { name: "Стад с белым CZ", reservations: 8, pct: 52 },
    { name: "Штанга для хряща 16G", reservations: 7, pct: 45 },
];

const TOP_SERVICES = [
    { name: "Пирсинг мочки уха", count: 38, pct: 100 },
    { name: "Пирсинг хряща", count: 29, pct: 76 },
    { name: "Пирсинг ноздри", count: 24, pct: 63 },
    { name: "Пирсинг перегородки", count: 17, pct: 45 },
    { name: "Замена украшения", count: 12, pct: 32 },
];

const maxReservations = Math.max(...MONTHLY_DATA.map((d) => d.reservations));
const maxAppointments = Math.max(...MONTHLY_DATA.map((d) => d.appointments));

export default function AnalyticsPage() {
    const [period, setPeriod] = useState<"week" | "month" | "year">("month");

    return (
        <>
            <div className={styles.pageHeader}>
                <div>
                    <h1 className={styles.pageHeading}>Статистика</h1>
                    <span className={styles.pageDesc}>Июль 2025</span>
                </div>
                <div className={styles.headerActions}>
                    {(["week", "month", "year"] as const).map((p) => (
                        <button
                            key={p}
                            className={`${styles.btn} ${period === p ? styles.btnPrimary : styles.btnSecondary} ${styles.btnSm}`}
                            onClick={() => setPeriod(p)}
                        >
                            {p === "week" ? "Неделя" : p === "month" ? "Месяц" : "Год"}
                        </button>
                    ))}
                    <button className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSm}`}>
                        Экспорт
                    </button>
                </div>
            </div>

            {/* Summary stats */}
            <div className={styles.statsRow}>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Броней за месяц</span>
                    <span className={styles.statValue}>28</span>
                    <span className={`${styles.statDelta} ${styles.statDeltaUp}`}>
                        +27% к прошлому месяцу
                    </span>
                </div>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Записей за месяц</span>
                    <span className={styles.statValue}>38</span>
                    <span className={`${styles.statDelta} ${styles.statDeltaUp}`}>
                        +22% к прошлому
                    </span>
                </div>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Новых клиентов</span>
                    <span className={styles.statValue}>9</span>
                    <span className={`${styles.statDelta} ${styles.statDeltaUp}`}>
                        +3 за неделю
                    </span>
                </div>
                <div className={styles.statCard}>
                    <span className={styles.statLabel}>Конверсия брони</span>
                    <span className={styles.statValue}>74%</span>
                    <span className={`${styles.statDelta} ${styles.statDeltaDown}`}>
                        -4% к прошлому
                    </span>
                </div>
            </div>

            <div className={styles.dashGrid}>
                {/* Left column */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {/* Reservations chart */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Брони по месяцам</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.chartArea}>
                                {MONTHLY_DATA.map((d) => (
                                    <div key={d.label} className={styles.bar}>
                                        <span className={styles.barValue}>{d.reservations}</span>
                                        <div
                                            className={styles.barFill}
                                            style={{
                                                height: `${(d.reservations / maxReservations) * 100}%`,
                                            }}
                                        />
                                    </div>
                                ))}
                            </div>
                            {/* Labels below chart */}
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: `repeat(${MONTHLY_DATA.length}, 1fr)`,
                                    marginTop: 6,
                                }}
                            >
                                {MONTHLY_DATA.map((d) => (
                                    <div
                                        key={d.label}
                                        style={{
                                            fontFamily: "var(--font-mono)",
                                            fontSize: "0.55rem",
                                            color: "var(--ink-muted)",
                                            textAlign: "center",
                                        }}
                                    >
                                        {d.label}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Appointments chart */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Записи по месяцам</h2>
                        </div>
                        <div className={styles.cardBody}>
                            <div className={styles.chartArea}>
                                {MONTHLY_DATA.map((d) => (
                                    <div key={d.label} className={styles.bar}>
                                        <span className={styles.barValue}>{d.appointments}</span>
                                        <div
                                            className={styles.barFill}
                                            style={{
                                                height: `${(d.appointments / maxAppointments) * 100}%`,
                                                background: "var(--adm-info)",
                                                opacity: 0.7,
                                            }}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div
                                style={{
                                    display: "grid",
                                    gridTemplateColumns: `repeat(${MONTHLY_DATA.length}, 1fr)`,
                                    marginTop: 6,
                                }}
                            >
                                {MONTHLY_DATA.map((d) => (
                                    <div
                                        key={d.label}
                                        style={{
                                            fontFamily: "var(--font-mono)",
                                            fontSize: "0.55rem",
                                            color: "var(--ink-muted)",
                                            textAlign: "center",
                                        }}
                                    >
                                        {d.label}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right column */}
                <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                    {/* Top products */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Популярные украшения</h2>
                        </div>
                        <div className={styles.cardBody}>
                            {TOP_PRODUCTS.map((p, i) => (
                                <div
                                    key={p.name}
                                    style={{ marginBottom: i < TOP_PRODUCTS.length - 1 ? 14 : 0 }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            marginBottom: 4,
                                        }}
                                    >
                                        <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>
                                            {p.name}
                                        </span>
                                        <span className={styles.tdMono}>{p.reservations}</span>
                                    </div>
                                    <div
                                        style={{
                                            height: 4,
                                            background: "var(--adm-rule)",
                                            borderRadius: 2,
                                            overflow: "hidden",
                                        }}
                                    >
                                        <div
                                            style={{
                                                height: "100%",
                                                width: `${p.pct}%`,
                                                background: "var(--adm-magenta)",
                                                opacity: 0.7,
                                                borderRadius: 2,
                                                transition: "width 600ms ease",
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Top services */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Популярные услуги</h2>
                        </div>
                        <div className={styles.cardBody}>
                            {TOP_SERVICES.map((s, i) => (
                                <div
                                    key={s.name}
                                    style={{ marginBottom: i < TOP_SERVICES.length - 1 ? 14 : 0 }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            marginBottom: 4,
                                        }}
                                    >
                                        <span style={{ fontSize: "0.8rem", fontWeight: 500 }}>
                                            {s.name}
                                        </span>
                                        <span className={styles.tdMono}>{s.count}</span>
                                    </div>
                                    <div
                                        style={{
                                            height: 4,
                                            background: "var(--adm-rule)",
                                            borderRadius: 2,
                                            overflow: "hidden",
                                        }}
                                    >
                                        <div
                                            style={{
                                                height: "100%",
                                                width: `${s.pct}%`,
                                                background: "var(--adm-info)",
                                                opacity: 0.7,
                                                borderRadius: 2,
                                                transition: "width 600ms ease",
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Reservation statuses */}
                    <div className={styles.card}>
                        <div className={styles.cardHeader}>
                            <h2 className={styles.cardTitle}>Статусы броней</h2>
                        </div>
                        <div className={styles.cardBody}>
                            {[
                                { label: "Выдано", count: 42, color: "#4ade80" },
                                { label: "Подтверждено", count: 7, color: "#60a5fa" },
                                { label: "Ожидает", count: 5, color: "#fbbf24" },
                                { label: "Истекло", count: 11, color: "#94a3b8" },
                                { label: "Отменено", count: 3, color: "#f87171" },
                            ].map((item) => (
                                <div
                                    key={item.label}
                                    className={styles.legendItem}
                                    style={{ marginBottom: 8 }}
                                >
                                    <span
                                        className={styles.legendDot}
                                        style={{ background: item.color }}
                                    />
                                    <span className={styles.legendLabel} style={{ flex: 1 }}>
                                        {item.label}
                                    </span>
                                    <span className={styles.tdMono}>{item.count}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
