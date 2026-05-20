import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db, productMedia, productPiercingAreas, products, productVariants } from "@/db";

import { MediaGallery } from "./MediaGallery";
import { PiercingAreaTags } from "./PiercingAreaTags";
import { VariantSelector } from "./VariantSelector";
import styles from "./product-detail.module.css";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProductDetailVariant {
    id: string;
    title: string;
    sku: string | null;
    materialFinish: string | null;
    gauge: string | null;
    lengthMm: string | null;
    diameterMm: string | null;
    gemType: string | null;
    gemColor: string | null;
    priceRub: number;
    inventoryQuantity: number | null;
    imageUrl: string | null;
}

interface ProductMediaItem {
    id: string;
    url: string;
    alt: string | null;
    kind: string;
    sortOrder: number;
}

interface ProductDetailData {
    id: string;
    handle: string;
    title: string;
    description: string | null;
    material: string;
    jewelryType: string;
    threading: string | null;
    has3dModel: boolean | null;
    thumbnailUrl: string | null;
    metaTitle: string | null;
    metaDescription: string | null;
    variants: ProductDetailVariant[];
    media: ProductMediaItem[];
    piercingAreas: string[];
}

// ---------------------------------------------------------------------------
// Data fetching
// ---------------------------------------------------------------------------

async function getProductByHandle(handle: string): Promise<ProductDetailData | null> {
    // Fetch product
    const [product] = await db
        .select()
        .from(products)
        .where(
            and(
                eq(products.handle, handle),
                eq(products.status, "published"),
                isNull(products.deletedAt)
            )
        )
        .limit(1);

    if (!product) return null;

    // Fetch variants, media, and piercing areas in parallel
    const [variants, media, areas] = await Promise.all([
        db
            .select({
                id: productVariants.id,
                title: productVariants.title,
                sku: productVariants.sku,
                materialFinish: productVariants.materialFinish,
                gauge: productVariants.gauge,
                lengthMm: productVariants.lengthMm,
                diameterMm: productVariants.diameterMm,
                gemType: productVariants.gemType,
                gemColor: productVariants.gemColor,
                priceRub: productVariants.priceRub,
                inventoryQuantity: productVariants.inventoryQuantity,
                imageUrl: productVariants.imageUrl,
            })
            .from(productVariants)
            .where(
                and(eq(productVariants.productId, product.id), isNull(productVariants.deletedAt))
            )
            .orderBy(asc(productVariants.sortOrder)),
        db
            .select({
                id: productMedia.id,
                url: productMedia.url,
                alt: productMedia.alt,
                kind: productMedia.kind,
                sortOrder: productMedia.sortOrder,
            })
            .from(productMedia)
            .where(eq(productMedia.productId, product.id))
            .orderBy(asc(productMedia.sortOrder)),
        db
            .select({ piercingArea: productPiercingAreas.piercingArea })
            .from(productPiercingAreas)
            .where(eq(productPiercingAreas.productId, product.id)),
    ]);

    return {
        id: product.id,
        handle: product.handle,
        title: product.title,
        description: product.description,
        material: product.material,
        jewelryType: product.jewelryType,
        threading: product.threading,
        has3dModel: product.has3dModel,
        thumbnailUrl: product.thumbnailUrl,
        metaTitle: product.metaTitle,
        metaDescription: product.metaDescription,
        variants: variants.map((v) => ({
            ...v,
            lengthMm: v.lengthMm ? String(v.lengthMm) : null,
            diameterMm: v.diameterMm ? String(v.diameterMm) : null,
        })),
        media,
        piercingAreas: areas.map((a) => a.piercingArea),
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
    const product = await getProductByHandle(handle);

    if (!product) {
        return { title: "Товар не найден — PiercerKZN" };
    }

    const title = product.metaTitle || `${product.title} — PiercerKZN`;
    const description =
        product.metaDescription ||
        product.description ||
        `${product.title} — украшение для пирсинга из ${MATERIAL_LABELS[product.material] || product.material}`;
    const imageUrl = product.thumbnailUrl || undefined;

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            url: `https://piercerkzn.ru/catalog/${product.handle}`,
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
// Material labels
// ---------------------------------------------------------------------------

const MATERIAL_LABELS: Record<string, string> = {
    titanium: "Титан",
    gold_14k: "Золото 14K",
    gold_18k: "Золото 18K",
    gold_white_14k: "Белое золото 14K",
    gold_rose_14k: "Розовое золото 14K",
    steel: "Сталь",
    niobium: "Ниобий",
    bioplast: "Биопласт",
};

const JEWELRY_TYPE_LABELS: Record<string, string> = {
    stud: "Лабрет",
    hoop: "Кольцо",
    barbell: "Штанга",
    curved_barbell: "Банан",
    circular_barbell: "Циркуляр",
    clicker: "Кликер",
    segment_ring: "Сегментное кольцо",
    nose_stud: "Нострил",
    septum: "Септум",
};

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default async function ProductDetailPage({ params }: PageProps) {
    const { handle } = await params;
    const product = await getProductByHandle(handle);

    if (!product) {
        notFound();
    }

    const materialLabel = MATERIAL_LABELS[product.material] || product.material;
    const typeLabel = JEWELRY_TYPE_LABELS[product.jewelryType] || product.jewelryType;

    return (
        <div className={styles.pdpPage}>
            <div className={styles.pdpGrid}>
                {/* Media Gallery */}
                <div className={styles.mediaColumn}>
                    <MediaGallery media={product.media} productTitle={product.title} />
                </div>

                {/* Product Info */}
                <div className={styles.infoColumn}>
                    <h1 className={styles.productTitle}>{product.title}</h1>

                    {/* Specs row */}
                    <div className={styles.specsRow}>
                        <span className={styles.specBadge}>{materialLabel}</span>
                        <span className={styles.specBadge}>{typeLabel}</span>
                        {product.threading && (
                            <span className={styles.specBadge}>{product.threading}</span>
                        )}
                    </div>

                    {/* Description */}
                    {product.description && (
                        <p className={styles.description}>{product.description}</p>
                    )}

                    {/* Variant Selector + Add to Cart */}
                    <VariantSelector
                        productId={product.id}
                        productTitle={product.title}
                        thumbnailUrl={product.thumbnailUrl}
                        variants={product.variants}
                    />

                    {/* 3D Model Link */}
                    {product.has3dModel && (
                        <a
                            href={`/visualizer?product=${product.handle}`}
                            className={styles.tryOnLink}
                        >
                            <span className={styles.tryOnIcon}>◇</span>
                            Примерить в 3D
                        </a>
                    )}

                    {/* Piercing Area Tags */}
                    {product.piercingAreas.length > 0 && (
                        <PiercingAreaTags areas={product.piercingAreas} />
                    )}
                </div>
            </div>
        </div>
    );
}
