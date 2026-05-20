import type { Metadata } from "next";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { curatedLooks, db, lookPieces } from "@/db";

import { LooksGrid } from "./LooksGrid";
import type { LookCardData } from "./LooksGrid";
import styles from "./looks.module.css";

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
    title: "Образы — PiercerKZN",
    description:
        "Готовые образы для пирсинга: подобранные комплекты украшений для уха, носа, губы и пупка со скидкой.",
    openGraph: {
        title: "Образы — PiercerKZN",
        description: "Готовые образы для пирсинга: подобранные комплекты украшений со скидкой.",
        url: "https://piercerkzn.ru/looks",
        type: "website",
    },
    twitter: {
        card: "summary",
        title: "Образы — PiercerKZN",
        description: "Готовые образы для пирсинга: подобранные комплекты украшений со скидкой.",
    },
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

// ---------------------------------------------------------------------------
// Server Component
// ---------------------------------------------------------------------------

interface LooksPageProps {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LooksPage({ searchParams }: LooksPageProps) {
    const params = await searchParams;

    // Parse query params
    const bodyArea = typeof params.bodyArea === "string" ? params.bodyArea : undefined;
    const page = typeof params.page === "string" ? Math.max(1, parseInt(params.page, 10) || 1) : 1;
    const offset = (page - 1) * PAGE_SIZE;

    // Fetch looks from DB
    const { looks, total } = await fetchLooks({ bodyArea, limit: PAGE_SIZE, offset });

    return (
        <div className={styles.looksPage}>
            <header className={styles.looksHeader}>
                <h1 className={styles.looksTitle}>Образы</h1>
                <p className={styles.looksSubtitle}>
                    Готовые комплекты украшений, подобранные мастером
                </p>
            </header>

            <LooksGrid
                initialLooks={looks}
                initialTotal={total}
                initialLimit={PAGE_SIZE}
                initialOffset={offset}
            />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Data fetching (direct DB query)
// ---------------------------------------------------------------------------

interface FetchParams {
    bodyArea?: string;
    limit: number;
    offset: number;
}

async function fetchLooks(params: FetchParams): Promise<{ looks: LookCardData[]; total: number }> {
    const { bodyArea, limit, offset } = params;

    // Build filters
    const filters = [eq(curatedLooks.isPublished, true)];
    if (bodyArea) filters.push(eq(curatedLooks.bodyArea, bodyArea));
    const where = and(...filters);

    // Execute query + count in parallel
    const [rows, countResult] = await Promise.all([
        db
            .select({
                id: curatedLooks.id,
                handle: curatedLooks.handle,
                title: curatedLooks.title,
                bodyArea: curatedLooks.bodyArea,
                thumbnailUrl: curatedLooks.thumbnailUrl,
                bundlePrice: curatedLooks.bundlePrice,
                discountPercent: curatedLooks.discountPercent,
                pieceCount: sql<number>`(
                    select count(*) from ${lookPieces}
                    where ${lookPieces.lookId} = ${curatedLooks.id}
                )::int`,
            })
            .from(curatedLooks)
            .where(where)
            .orderBy(asc(curatedLooks.sortOrder), desc(curatedLooks.createdAt))
            .limit(limit)
            .offset(offset),
        db
            .select({ total: sql<number>`count(*)::int` })
            .from(curatedLooks)
            .where(where),
    ]);

    const looks: LookCardData[] = rows.map((row) => ({
        id: row.id,
        handle: row.handle,
        title: row.title,
        thumbnailUrl: row.thumbnailUrl,
        bodyArea: row.bodyArea,
        bundlePrice: row.bundlePrice,
        discountPercent: row.discountPercent,
        pieceCount: row.pieceCount,
    }));

    return { looks, total: countResult[0]?.total ?? 0 };
}
