"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import styles from "./reservation-detail.module.css";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReservationNotFound() {
    const router = useRouter();
    const [refInput, setRefInput] = useState("");

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const trimmed = refInput.trim();
        if (trimmed) {
            router.push(`/reservations/${encodeURIComponent(trimmed)}`);
        }
    }

    return (
        <div className={styles.notFoundPage}>
            <div className={styles.notFoundCard}>
                <h1 className={styles.notFoundTitle}>404</h1>
                <p className={styles.notFoundText}>
                    Бронирование не найдено. Проверьте номер и попробуйте снова.
                </p>
                <form className={styles.searchForm} onSubmit={handleSubmit}>
                    <input
                        type="text"
                        className={styles.searchInput}
                        placeholder="PK-RES-2026-0001"
                        value={refInput}
                        onChange={(e) => setRefInput(e.target.value)}
                        aria-label="Номер бронирования"
                    />
                    <button type="submit" className={styles.searchBtn}>
                        Найти
                    </button>
                </form>
            </div>
        </div>
    );
}
