import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Image from "next/image";

import { and, asc, eq } from "drizzle-orm";

import { curatedLooks, db, lookPieces, piercingPoints, productVariants, products } from "@/db";

import { LookActions } from "./LookActions";
import { LookPieceRow } from "./LookPieceRow";
import styles from "./look-detail.module.css";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LookPieceData {
    id: string;
    sortOrder: number | null;
    piercingPointLabel: string;
    product: {
        id: string;
        title: string;
        handle: string;
        thumbnailUrl: string | null;
    };
    variant: {
        id: string;
        title: string;
        gauge: string | null;
        lengthMm: string | null;
        materialFinish: string | null;
        gemType: string | null;
        gemColor: string | null;
        priceRub: number;
        imageUrl: string | null;
    };
}

interface LookDetailData {
    id: string;
    handle: string;
    title: string;
    description: string | null;
    bodyArea: string;
    thumbnailUrl: string | null;
    totalIndividualPrice: number;
    bundlePrice: number;
    discountPercent: string | null;
    pieces: LookPieceData[];
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getLookByHandle(handle: string): Promise<LookDetailData | null> {
    const [look] = await db
        .select()
        .from(curatedLooks)
        .where(and(eq(curatedLooks.handle, handle), eq(curatedLooks.isPublished, true)))
        .limit(1);

    if (!look) return null;

    const pieceRows = await db
        .select({
            id: lookPieces.id,
            sortOrder: lookPieces.sortOrder,
            piercingPointDisplayName: piercingPoints.displayName,
            variantId: productVariants.id,
            variantTitle: productVariants.title,
            variantGauge: productVariants.gauge,
            variantLengthMm: productVariants.lengthMm,
            variantMaterialFinish: productVariants.materialFinish,
            variantGemType: productVariants.gemType,
            variantGemColor: productVariants.gemColor,
            variantPriceRub: productVariants.priceRub,
            variantImageUrl: productVariants.imageUrl,
            productId: products.id,
            productTitle: products.title,
            productHandle: products.handle,
            productThumbnailUrl: products.thumbnailUrl,
        })
        .from(lookPieces)
        .innerJoin(piercingPoints, eq(piercingPoints.id, lookPieces.piercingPointId))
        .innerJoin(productVariants, eq(productVariants.id, lookPieces.variantId))
        .innerJoin(products, eq(products.id, productVariants.productId))
        .where(eq(lookPieces.lookId, look.id))
        .orderBy(asc(lookPieces.sortOrder));

    const pieces: LookPieceData[] = pieceRows.map((p) => ({
        id: p.id,
        sortOrder: p.sortOrder,
        piercingPointLabel: p.piercingPointDisplayName,
        product: {
            id: p.productId,
            title: p.productTitle,
            handle: p.productHandle,
            thumbnailUrl: p.productThumbnailUrl,
        },
        variant: {
            id: p.variantId,
            title: p.variantTitle,
            gauge: p.variantGauge,
            lengthMm: p.variantLengthMm ? String(p.variantLengthMm) : null,
            materialFinish: p.variantMaterialFinish,
            gemType: p.variantGemType,
            gemColor: p.variantGemColor,
            priceRub: p.variantPriceRub,
            imageUrl: p.variantImageUrl,
        },
    }));

    return {
        id: look.id,
        handle: look.handle,
        title: look.title,
        description: look.description,
        bodyArea: look.bodyArea,
        thumbnailUrl: look.thumbnailUrl,
        totalIndividualPrice: look.totalIndividualPrice,
        bundlePrice: look.bundlePrice,
        discountPercent: look.discountPercent,
        pieces,
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
    const look = await getLookByHandle(handle);

    if (!look) {
        return { title: "Образ не найден — PiercerKZN" };
    }

    const title = `${look.title} — PiercerKZN`;
    const description =
        look.description || `Образ «${look.title}» — ${look.pieces.length} украшений со скидкой`;
    const imageUrl = look.thumbnailUrl || undefined;

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            url: `https://piercerkzn.ru/looks/${look.handle}`,
            type: "website",
            ...(imageUrl && { images: [{ url: imageUrl }] }),
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            ...(imageUrl && { images: [imageUrl] }),
        },
    };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(kopecks: number): string {
    const rub = Math.floor(kopecks);
    return new Intl.NumberFormat("ru-RU").format(rub) + " ₽";
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default async function LookDetailPage({ params }: PageProps) {
    const { handle } = await params;
    const look = await getLookByHandle(handle);

    if (!look) {
        notFound();
    }

    const savings = look.totalIndividualPrice - look.bundlePrice;

    return (
        <div className={styles.lookDetailPage}>
            {/* Hero section */}
            <div className={styles.heroSection}>
                <div className={styles.heroImage}>
                    {look.thumbnailUrl ? (
                        <Image
                            src={look.thumbnailUrl}
                            alt={look.title}
                            fill
                            sizes="(max-width: 768px) 100vw, 50vw"
                            className={styles.heroImg}
                            priority
                        />
                    ) : (
                        <div className={styles.heroPlaceholder}>
                            <span className={styles.heroPlaceholderText}>Нет изображения</span>
                        </div>
                    )}
                    <div className={styles.heroVignette} aria-hidden="true" />
                </div>

                <div className={styles.heroInfo}>
                    <h1 className={styles.lookTitle}>{look.title}</h1>
                    {look.description && (
                        <p className={styles.lookDescription}>{look.description}</p>
                    )}
                    <div className={styles.bodyAreaBadge}>
                        <span className={styles.bodyAreaLabel}>{look.bodyArea}</span>
                    </div>
                </div>
            </div>

            {/* Pieces list */}
            <section className={styles.piecesSection}>
                <h2 className={styles.sectionTitle}>Состав образа</h2>
                <div className={styles.piecesList}>
                    {look.pieces.map((piece) => (
                        <LookPieceRow key={piece.id} piece={piece} />
                    ))}
                </div>
            </section>

            {/* Pricing summary */}
            <section className={styles.pricingSection}>
                <div className={styles.pricingCard}>
                    <div className={styles.pricingRow}>
                        <span className={styles.pricingLabel}>Сумма по отдельности</span>
                        <span className={styles.pricingValue}>
                            {formatPrice(look.totalIndividualPrice)}
                        </span>
                    </div>
                    <div className={styles.pricingRow}>
                        <span className={styles.pricingLabel}>Цена комплекта</span>
                        <span className={styles.pricingAccent}>
                            {formatPrice(look.bundlePrice)}
                        </span>
                    </div>
                    {savings > 0 && (
                        <div className={styles.pricingRow}>
                            <span className={styles.pricingLabel}>Выгода</span>
                            <span className={styles.savingsValue}>
                                −{formatPrice(savings)}
                                {look.discountPercent && (
                                    <span className={styles.savingsBadge}>
                                        −{look.discountPercent}%
                                    </span>
                                )}
                            </span>
                        </div>
                    )}
                </div>
            </section>

            {/* Actions */}
            <LookActions
                lookId={look.id}
                pieces={look.pieces.map((p) => ({
                    variantId: p.variant.id,
                    productId: p.product.id,
                    title: p.product.title,
                    variantTitle: p.variant.title,
                    thumbnailUrl: p.variant.imageUrl || p.product.thumbnailUrl,
                    unitPrice: p.variant.priceRub,
                }))}
            />
        </div>
    );
}
