import { desc, eq, sql, inArray } from "drizzle-orm";
import Link from "next/link";

import { auth } from "@/lib/auth";
import { db, reservations, reservationItems } from "@/db";

import styles from "./reservations.module.css";

export const dynamic = "force-dynamic";

export default async function AccountReservationsPage() {
    const session = await auth();
    const customerId = session!.user!.customerId!;

    const customerReservations = await db
        .select({
            id: reservations.id,
            referenceNumber: reservations.referenceNumber,
            status: reservations.status,
            total: reservations.total,
            expiresAt: reservations.expiresAt,
            createdAt: reservations.createdAt,
        })
        .from(reservations)
        .where(eq(reservations.customerId, customerId))
        .orderBy(desc(reservations.createdAt));

    // Get item counts for each reservation
    const reservationIds = customerReservations.map((r) => r.id);
    let itemCounts: Record<string, number> = {};
    if (reservationIds.length > 0) {
        const counts = await db
            .select({
                reservationId: reservationItems.reservationId,
                count: sql<number>`count(*)::int`,
            })
            .from(reservationItems)
            .where(inArray(reservationItems.reservationId, reservationIds))
            .groupBy(reservationItems.reservationId);

        itemCounts = counts.reduce(
            (acc, row) => {
                acc[row.reservationId] = row.count;
                return acc;
            },
            {} as Record<string, number>
        );
    }

    return (
        <div className={styles.page}>
            <h1 className={styles.pageTitle}>Мои брони</h1>

            {customerReservations.length === 0 ? (
                <div className={styles.emptyState}>
                    <p className={styles.emptyText}>У вас пока нет броней</p>
                    <Link href="/catalog" className={styles.ctaLink}>
                        Перейти в каталог
                    </Link>
                </div>
            ) : (
                <ul className={styles.list}>
                    {customerReservations.map((res) => (
                        <li key={res.id} className={styles.card}>
                            <div className={styles.cardHeader}>
                                <Link
                                    href={`/reservations/${res.referenceNumber}`}
                                    className={styles.refLink}
                                >
                                    {res.referenceNumber}
                                </Link>
                                <span className={styles.statusBadge} data-status={res.status}>
                                    {statusLabel(res.status)}
                                </span>
                            </div>
                            <div className={styles.cardBody}>
                                <span className={styles.itemCount}>
                                    {itemCounts[res.id] ?? 0} {pluralItems(itemCounts[res.id] ?? 0)}
                                </span>
                                <span className={styles.cardPrice}>{formatPrice(res.total)}</span>
                            </div>
                            <div className={styles.cardFooter}>
                                {res.expiresAt && (
                                    <span className={styles.cardMeta}>
                                        Истекает: {formatDateTime(res.expiresAt)}
                                    </span>
                                )}
                                {res.createdAt && (
                                    <span className={styles.cardMeta}>
                                        Создана: {formatDateTime(res.createdAt)}
                                    </span>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Helpers ──

function formatDateTime(date: Date): string {
    return date.toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        year: "numeric",
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
        picked_up: "Получена",
        cancelled: "Отменена",
        expired: "Истекла",
    };
    return map[status ?? ""] ?? status ?? "—";
}

function pluralItems(count: number): string {
    if (count === 1) return "позиция";
    if (count >= 2 && count <= 4) return "позиции";
    return "позиций";
}
