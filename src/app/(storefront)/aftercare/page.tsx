import type { Metadata } from "next";

import { and, asc, eq } from "drizzle-orm";

import { aftercareGuides, db } from "@/db";

import { AftercareGrid } from "./AftercareGrid";
import type { AftercareCardData } from "./AftercareGrid";
import styles from "./aftercare.module.css";

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
    title: "Уход после прокола — PiercerKZN",
    description:
        "Гайды по уходу за пирсингом: сроки заживления, ежедневный уход, рекомендации и предупреждения для каждого типа прокола.",
    openGraph: {
        title: "Уход после прокола — PiercerKZN",
        description: "Гайды по уходу за пирсингом: сроки заживления и рекомендации.",
        url: "https://piercerkzn.ru/aftercare",
        type: "website",
    },
    twitter: {
        card: "summary",
        title: "Уход после прокола — PiercerKZN",
        description: "Гайды по уходу за пирсингом: сроки заживления и рекомендации.",
    },
};

// ---------------------------------------------------------------------------
// ISR Config — revalidate every 5 minutes
// ---------------------------------------------------------------------------

export const revalidate = 300;

// ---------------------------------------------------------------------------
// Server Component
// ---------------------------------------------------------------------------

interface AftercarePageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AftercarePage({ searchParams }: AftercarePageProps) {
    const params = await searchParams;

    // Parse query params
    const piercingType = typeof params.piercingType === "string" ? params.piercingType : undefined;

    // Fetch guides from DB
    const { guides, availableTypes } = await fetchAftercareGuides({ piercingType });

    return (
        <div className={styles.aftercarePage}>
            <header className={styles.aftercareHeader}>
                <h1 className={styles.aftercareTitle}>Уход после прокола</h1>
                <p className={styles.aftercareSubtitle}>
                    Подробные гайды по заживлению для каждого типа пирсинга
                </p>
            </header>

            <AftercareGrid initialGuides={guides} availableTypes={availableTypes} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Data fetching (direct DB query)
// ---------------------------------------------------------------------------

interface FetchParams {
    piercingType?: string;
}

async function fetchAftercareGuides(
    params: FetchParams
): Promise<{ guides: AftercareCardData[]; availableTypes: string[] }> {
    const { piercingType } = params;

    // Build filters
    const filters = [eq(aftercareGuides.isPublished, true)];
    if (piercingType) filters.push(eq(aftercareGuides.piercingType, piercingType));

    // Fetch guides and all available types in parallel
    const [rows, allTypesResult] = await Promise.all([
        db
            .select({
                id: aftercareGuides.id,
                handle: aftercareGuides.handle,
                title: aftercareGuides.title,
                piercingType: aftercareGuides.piercingType,
                healingMinWeeks: aftercareGuides.healingMinWeeks,
                healingMaxWeeks: aftercareGuides.healingMaxWeeks,
                iconUrl: aftercareGuides.iconUrl,
            })
            .from(aftercareGuides)
            .where(and(...filters))
            .orderBy(asc(aftercareGuides.title)),
        db
            .selectDistinct({ piercingType: aftercareGuides.piercingType })
            .from(aftercareGuides)
            .where(eq(aftercareGuides.isPublished, true))
            .orderBy(asc(aftercareGuides.piercingType)),
    ]);

    const guides: AftercareCardData[] = rows.map((row) => ({
        id: row.id,
        handle: row.handle,
        title: row.title,
        piercingType: row.piercingType,
        healingMinWeeks: row.healingMinWeeks,
        healingMaxWeeks: row.healingMaxWeeks,
        iconUrl: row.iconUrl,
    }));

    const availableTypes = allTypesResult.map((r) => r.piercingType);

    return { guides, availableTypes };
}
