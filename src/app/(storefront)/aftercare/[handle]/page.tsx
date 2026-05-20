import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { and, eq } from "drizzle-orm";

import { aftercareGuides, db } from "@/db";

import { GuideSection } from "./GuideSection";
import type { AftercareContent } from "./GuideSection";
import styles from "./aftercare-detail.module.css";

// ---------------------------------------------------------------------------
// ISR Config — revalidate every 5 minutes
// ---------------------------------------------------------------------------

export const revalidate = 300;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AftercareGuideData {
    id: string;
    handle: string;
    title: string;
    piercingType: string;
    content: AftercareContent;
    healingMinWeeks: number | null;
    healingMaxWeeks: number | null;
    version: number | null;
    metaTitle: string | null;
    metaDescription: string | null;
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getGuideByHandle(handle: string): Promise<AftercareGuideData | null> {
    const [row] = await db
        .select({
            id: aftercareGuides.id,
            handle: aftercareGuides.handle,
            title: aftercareGuides.title,
            piercingType: aftercareGuides.piercingType,
            content: aftercareGuides.content,
            healingMinWeeks: aftercareGuides.healingMinWeeks,
            healingMaxWeeks: aftercareGuides.healingMaxWeeks,
            version: aftercareGuides.version,
            metaTitle: aftercareGuides.metaTitle,
            metaDescription: aftercareGuides.metaDescription,
        })
        .from(aftercareGuides)
        .where(and(eq(aftercareGuides.handle, handle), eq(aftercareGuides.isPublished, true)))
        .limit(1);

    if (!row) return null;

    return {
        id: row.id,
        handle: row.handle,
        title: row.title,
        piercingType: row.piercingType,
        content: row.content as AftercareContent,
        healingMinWeeks: row.healingMinWeeks,
        healingMaxWeeks: row.healingMaxWeeks,
        version: row.version,
        metaTitle: row.metaTitle,
        metaDescription: row.metaDescription,
    };
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

interface PageProps {
    params: Promise<{ handle: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { handle } = await params;
    const guide = await getGuideByHandle(handle);

    if (!guide) {
        return { title: "Гайд не найден — PiercerKZN" };
    }

    const title = guide.metaTitle || `${guide.title} — PiercerKZN`;
    const healingRange = formatHealingRange(guide.healingMinWeeks, guide.healingMaxWeeks);
    const description =
        guide.metaDescription ||
        `Уход за пирсингом ${PIERCING_TYPE_LABELS[guide.piercingType] || guide.piercingType}. Заживление: ${healingRange}. Подробный гайд с рекомендациями.`;

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            url: `https://piercerkzn.ru/aftercare/${guide.handle}`,
            type: "article",
        },
        twitter: {
            card: "summary",
            title,
            description,
        },
    };
}

// ---------------------------------------------------------------------------
// Piercing type labels (Russian)
// ---------------------------------------------------------------------------

const PIERCING_TYPE_LABELS: Record<string, string> = {
    ear_helix: "Хеликс",
    ear_tragus: "Трагус",
    ear_conch: "Конч",
    ear_rook: "Рук",
    ear_daith: "Дейс",
    ear_industrial: "Индастриал",
    ear_lobe: "Мочка уха",
    ear_forward_helix: "Форвард хеликс",
    nose_septum: "Септум",
    nose_nostril: "Нострил",
    nose_bridge: "Бридж",
    lip_labret: "Лабрет",
    lip_medusa: "Медуза",
    lip_monroe: "Монро",
    eyebrow: "Бровь",
    navel: "Пупок",
    tongue: "Язык",
    dermal: "Дермал",
};

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default async function AftercareDetailPage({ params }: PageProps) {
    const { handle } = await params;
    const guide = await getGuideByHandle(handle);

    if (!guide) {
        notFound();
    }

    const healingRange = formatHealingRange(guide.healingMinWeeks, guide.healingMaxWeeks);
    const piercingLabel = PIERCING_TYPE_LABELS[guide.piercingType] || guide.piercingType;

    return (
        <div className={styles.detailPage}>
            {/* Back navigation */}
            <Link href="/aftercare" className={styles.backLink}>
                ← Все гайды
            </Link>

            {/* Header */}
            <header className={styles.detailHeader}>
                <h1 className={styles.detailTitle}>{guide.title}</h1>
                <div className={styles.headerMeta}>
                    <span className={styles.piercingTypeBadge}>{piercingLabel}</span>
                    {healingRange && <span className={styles.healingBadge}>{healingRange}</span>}
                    {guide.version != null && (
                        <span className={styles.versionBadge}>v{guide.version}</span>
                    )}
                </div>
            </header>

            {/* Guide content sections */}
            <GuideSection content={guide.content} />
        </div>
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatHealingRange(min: number | null, max: number | null): string {
    if (min != null && max != null) {
        return `${min}–${max} нед.`;
    }
    if (min != null) {
        return `от ${min} нед.`;
    }
    if (max != null) {
        return `до ${max} нед.`;
    }
    return "";
}
