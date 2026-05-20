import type { Metadata } from "next";
import Image from "next/image";

import { eq } from "drizzle-orm";

import { db, reservations, reservationItems } from "@/db";

import { ExpiryCountdown } from "./ExpiryCountdown";
import { ReservationNotFound } from "./ReservationNotFound";
import styles from "./reservation-detail.module.css";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReservationItemData {
    id: string;
    title: string;
    variantTitle: string | null;
    thumbnailUrl: string | null;
    unitPrice: number;
    quantity: number;
    total: number;
}

interface ReservationData {
    referenceNumber: string;
    status: string;
    total: number;
    expiresAt: string;
    createdAt: string;
    items: ReservationItemData[];
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
            thumbnailUrl: reservationItems.thumbnailUrl,
            unitPrice: reservationItems.unitPrice,
            quantity: reservationItems.quantity,
            total: reservationItems.total,
        })
        .from(reservationItems)
        .where(eq(reservationItems.reservationId, reservation.id));

    return {
        referenceNumber: reservation.referenceNumber,
        status: reservation.status ?? "pending",
        total: reservation.total,
        expiresAt: reservation.expiresAt.toISOString(),
        createdAt: reservation.createdAt?.toISOString() ?? new Date().toISOString(),
        items,
    };
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

interface PageProps {
    params: Promise<{ ref: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { ref } = await params;
    return {
        title: `Бронь ${ref} — PiercerKZN`,
        description: `Статус бронирования ${ref}`,
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
    pending: "Ожидает",
    confirmed: "Подтверждена",
    picked_up: "Выдана",
    cancelled: "Отменена",
    expired: "Истекла",
};

function formatPrice(kopecks: number): string {
    const rub = Math.floor(kopecks);
    return new Intl.NumberFormat("ru-RU").format(rub) + " ₽";
}

function formatDateMoscow(isoString: string): string {
    return new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        day: "numeric",
        month: "long",
        year: "numeric",
    }).format(new Date(isoString));
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

export default async function ReservationDetailPage({ params }: PageProps) {
    const { ref } = await params;
    const reservation = await getReservationByRef(ref);

    if (!reservation) {
        return <ReservationNotFound />;
    }

    const showCountdown = reservation.status === "pending" || reservation.status === "confirmed";

    return (
        <div className={styles.reservationPage}>
            {/* Header */}
            <div className={styles.headerSection}>
                <h1 className={styles.refNumber}>{reservation.referenceNumber}</h1>
                <div className={styles.metaRow}>
                    <span className={styles.statusBadge} data-status={reservation.status}>
                        {STATUS_LABELS[reservation.status] || reservation.status}
                    </span>
                    <span className={styles.metaLabel}>
                        Создана {formatDateMoscow(reservation.createdAt)}
                    </span>
                </div>
            </div>

            {/* Dates */}
            <div className={styles.datesCard}>
                <div className={styles.dateRow}>
                    <span className={styles.dateLabel}>Дата создания</span>
                    <span className={styles.dateValue}>
                        {formatDateTimeMoscow(reservation.createdAt)}
                    </span>
                </div>
                <div className={styles.dateRow}>
                    <span className={styles.dateLabel}>Истекает</span>
                    <span className={styles.dateValue}>
                        {formatDateTimeMoscow(reservation.expiresAt)}
                    </span>
                </div>
            </div>

            {/* Countdown */}
            {showCountdown && <ExpiryCountdown expiresAt={reservation.expiresAt} />}

            {/* Items */}
            <section className={styles.itemsSection}>
                <h2 className={styles.sectionTitle}>Состав бронирования</h2>
                <div className={styles.itemsList}>
                    {reservation.items.map((item) => (
                        <div key={item.id} className={styles.itemRow}>
                            {/* Thumbnail */}
                            {item.thumbnailUrl ? (
                                <Image
                                    src={item.thumbnailUrl}
                                    alt={item.title}
                                    width={56}
                                    height={56}
                                    className={styles.itemThumbnail}
                                />
                            ) : (
                                <div className={styles.itemPlaceholder}>
                                    <span className={styles.itemPlaceholderIcon}>◇</span>
                                </div>
                            )}

                            {/* Info */}
                            <div className={styles.itemInfo}>
                                <p className={styles.itemTitle}>{item.title}</p>
                                {item.variantTitle && (
                                    <span className={styles.itemVariant}>{item.variantTitle}</span>
                                )}
                                <span className={styles.itemQty}>
                                    {item.quantity} шт. × {formatPrice(item.unitPrice)}
                                </span>
                            </div>

                            {/* Pricing */}
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
                <span className={styles.totalLabel}>Итого</span>
                <span className={styles.totalValue}>{formatPrice(reservation.total)}</span>
            </div>
        </div>
    );
}
