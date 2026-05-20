"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import styles from "./reservation-detail.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExpiryCountdownProps {
    expiresAt: string; // ISO timestamp
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function computeRemaining(expiresAt: string): number {
    const diff = new Date(expiresAt).getTime() - Date.now();
    return Math.max(0, diff);
}

function formatCountdown(ms: number): string {
    if (ms <= 0) return "00:00:00";

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExpiryCountdown({ expiresAt }: ExpiryCountdownProps) {
    const router = useRouter();
    const [remaining, setRemaining] = useState(() => computeRemaining(expiresAt));

    const handleExpiry = useCallback(() => {
        // Re-fetch the page data when countdown reaches zero
        router.refresh();
    }, [router]);

    useEffect(() => {
        const tick = () => {
            const ms = computeRemaining(expiresAt);
            setRemaining(ms);

            if (ms <= 0) {
                handleExpiry();
                return;
            }
        };

        // Initial tick
        tick();

        const interval = setInterval(tick, 1000);
        return () => clearInterval(interval);
    }, [expiresAt, handleExpiry]);

    const isExpired = remaining <= 0;

    return (
        <div className={styles.countdownSection}>
            <span className={styles.countdownLabel}>
                {isExpired ? "Время истекло" : "Осталось времени"}
            </span>
            <span
                className={`${styles.countdownTimer} ${isExpired ? styles.countdownExpired : ""}`}
            >
                {formatCountdown(remaining)}
            </span>
        </div>
    );
}
