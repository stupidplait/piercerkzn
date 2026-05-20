import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { eq, inArray } from "drizzle-orm";

import { db, reservations, reservationItems, settings } from "@/db";

import styles from "./reservation-confirm.module.css";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "Бронь подтверждена — PiercerKZN",
    description: "Подтверждение бронирования украшений",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReservationItemData {
    id: string;
    title: string;
    variantTitle: string | null;
    unitPrice: number;
    quantity: number;
    total: number;
}

interface ReservationData {
    referenceNumber: string;
    total: number;
    expiresAt: string;
    items: ReservationItemData[];
}

interface StudioSettings {
    address: string | null;
    hours: string | null;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getReservationByRef(ref: string): Promise<ReservationData | null> {
    const [reservation] = await db
        .select()
        .from(reservations)
        .where(eq(reservations.referenceNumber, ref))
        .limit(1);

    if (!reservation) return null;

    const items = await db
        .select({
            id: reservationItems.id,
            title: reservationItems.title,
            variantTitle: reservationItems.variantTitle,
            unitPrice: reservationItems.unitPrice,
            quantity: reservationItems.quantity,
            total: reservationItems.total,
        })
        .from(reservationItems)
        .where(eq(reservationItems.reservationId, reservation.id));

    return {
        referenceNumber: reservation.referenceNumber,
        total: reservation.total,
        expiresAt: reservation.expiresAt.toISOString(),
        items,
    };
}

async function getStudioSettings(): Promise<StudioSettings> {
    const rows = await db
        .select({ key: settings.key, value: settings.value })
        .from(settings)
        .where(inArray(settings.key, ["studio.address", "studio.hours"]));

    let address: string | null = null;
    let hours: string | null = null;

    for (const row of rows) {
        const val = row.value as { text?: string } | undefined;
        if (row.key === "studio.address") {
            address = val?.text ?? null;
        } else if (row.key === "studio.hours") {
            hours = val?.text ?? null;
        }
    }

    return { address, hours };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(kopecks: number): string {
    const rub = Math.floor(kopecks);
    return new Intl.NumberFormat("ru-RU").format(rub) + " ₽";
}

function formatDateTimeMoscow(isoString: string): string {
    return new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(isoString));
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

interface PageProps {
    searchParams: Promise<{ ref?: string }>;
}

export default async function ReservationConfirmPage({ searchParams }: PageProps) {
    const { ref } = await searchParams;

    // Redirect to cart if no ref param
    if (!ref) {
        redirect("/cart");
    }

    const reservation = await getReservationByRef(ref);

    // Redirect to cart if reservation not found
    if (!reservation) {
        redirect("/cart");
    }

    const studioSettings = await getStudioSettings();

    // Fallback values for studio info (matching the about page)
    const studioAddress =
        studioSettings.address ?? "г. Казань, ул. Баумана, 68 (вход со двора, 2 этаж)";
    const studioHours =
        studioSettings.hours ?? "Пн–Пт: 11:00 – 20:00\nСб: 12:00 – 18:00\nВс: выходной";

    return (
        <div className={styles.confirmPage}>
            {/* Success header */}
            <header className={styles.successHeader}>
                <div className={styles.successIcon} aria-hidden="true">
                    ✓
                </div>
                <h1 className={styles.successTitle}>Бронь оформлена</h1>
                <p className={styles.successSubtitle}>
                    Мы отложили украшения для вас. Заберите их в студии до истечения срока.
                </p>
            </header>

            {/* Reference number & expiry */}
            <div className={styles.refCard}>
                <div className={styles.refRow}>
                    <span className={styles.refLabel}>Номер брони</span>
                    <span className={styles.refValue}>{reservation.referenceNumber}</span>
                </div>
                <div className={styles.expiryRow}>
                    <span className={styles.expiryLabel}>Действует до</span>
                    <span className={styles.expiryValue}>
                        {formatDateTimeMoscow(reservation.expiresAt)} (МСК)
                    </span>
                </div>
            </div>

            {/* Reserved items */}
            <section className={styles.itemsSection}>
                <h2 className={styles.sectionTitle}>Зарезервированные украшения</h2>
                <div className={styles.itemsList}>
                    {reservation.items.map((item) => (
                        <div key={item.id} className={styles.itemRow}>
                            <div className={styles.itemInfo}>
                                <p className={styles.itemTitle}>{item.title}</p>
                                {item.variantTitle && (
                                    <span className={styles.itemVariant}>{item.variantTitle}</span>
                                )}
                                <span className={styles.itemQty}>
                                    {item.quantity} шт. × {formatPrice(item.unitPrice)}
                                </span>
                            </div>
                            <div className={styles.itemPricing}>
                                <span className={styles.itemLineTotal}>
                                    {formatPrice(item.total)}
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Total */}
            <div className={styles.totalRow}>
                <span className={styles.totalLabel}>Итого к оплате</span>
                <span className={styles.totalValue}>{formatPrice(reservation.total)}</span>
            </div>

            {/* Pickup instructions */}
            <section className={styles.pickupSection}>
                <h2 className={styles.pickupTitle}>Как забрать</h2>

                <div className={styles.pickupRow}>
                    <span className={styles.pickupLabel}>Адрес студии</span>
                    <span className={styles.pickupValue}>{studioAddress}</span>
                </div>

                <div className={styles.pickupRow}>
                    <span className={styles.pickupLabel}>Часы работы</span>
                    <span className={styles.pickupValue}>{studioHours}</span>
                </div>

                <p className={styles.cashReminder}>💵 Оплата только наличными при получении</p>
            </section>

            {/* Track reservation link */}
            <div className={styles.trackSection}>
                <Link
                    href={`/reservations/${reservation.referenceNumber}`}
                    className={styles.trackLink}
                >
                    Отслеживать статус брони →
                </Link>
            </div>
        </div>
    );
}
