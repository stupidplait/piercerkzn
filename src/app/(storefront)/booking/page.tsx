import type { Metadata } from "next";

import { eq } from "drizzle-orm";

import { db, services, waiverTemplates } from "@/db";

import { BookingWizard } from "./BookingWizard";
import styles from "./booking.module.css";

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
    title: "Запись на приём — PiercerKZN",
    description:
        "Запишитесь на пирсинг, замену украшения или консультацию онлайн. Выберите услугу, дату и время.",
    openGraph: {
        title: "Запись на приём — PiercerKZN",
        description: "Запишитесь на пирсинг, замену украшения или консультацию онлайн.",
        url: "https://piercerkzn.ru/booking",
        type: "website",
    },
    twitter: {
        card: "summary",
        title: "Запись на приём — PiercerKZN",
        description: "Запишитесь на пирсинг, замену украшения или консультацию онлайн.",
    },
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const revalidate = 300; // ISR 5min

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServiceItem {
    id: string;
    name: string;
    category: string;
    durationMinutes: number;
    priceFrom: number;
    priceTo: number | null;
    description: string | null;
}

export type ServicesByCategory = Record<string, ServiceItem[]>;

export interface WaiverData {
    version: number;
    content: string;
}

// ---------------------------------------------------------------------------
// Server Component
// ---------------------------------------------------------------------------

export default async function BookingPage() {
    const [serviceRows, waiverRow] = await Promise.all([
        db
            .select({
                id: services.id,
                name: services.name,
                category: services.category,
                durationMinutes: services.durationMinutes,
                priceFrom: services.priceFrom,
                priceTo: services.priceTo,
                description: services.description,
            })
            .from(services)
            .where(eq(services.isActive, true))
            .orderBy(services.sortOrder),
        db
            .select({
                version: waiverTemplates.version,
                content: waiverTemplates.content,
            })
            .from(waiverTemplates)
            .where(eq(waiverTemplates.isActive, true))
            .orderBy(waiverTemplates.version)
            .limit(1),
    ]);

    // Group services by category
    const servicesByCategory: ServicesByCategory = {};
    for (const svc of serviceRows) {
        if (!servicesByCategory[svc.category]) {
            servicesByCategory[svc.category] = [];
        }
        servicesByCategory[svc.category].push({
            id: svc.id,
            name: svc.name,
            category: svc.category,
            durationMinutes: svc.durationMinutes,
            priceFrom: svc.priceFrom,
            priceTo: svc.priceTo,
            description: svc.description,
        });
    }

    const waiver: WaiverData = waiverRow[0] ?? { version: 1, content: "" };

    return (
        <div className={styles.bookingPage}>
            <header className={styles.bookingHeader}>
                <h1 className={styles.bookingTitle}>Запись</h1>
                <p className={styles.bookingSubtitle}>
                    Выберите услугу, дату и время — мы подготовим всё к вашему визиту
                </p>
            </header>

            <BookingWizard servicesByCategory={servicesByCategory} waiver={waiver} />
        </div>
    );
}
