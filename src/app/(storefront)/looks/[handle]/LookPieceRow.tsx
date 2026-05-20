import Link from "next/link";

import styles from "./look-detail.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LookPieceData {
    id: string;
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

interface LookPieceRowProps {
    piece: LookPieceData;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(kopecks: number): string {
    const rub = Math.floor(kopecks);
    return new Intl.NumberFormat("ru-RU").format(rub) + " ₽";
}

function formatVariantSpecs(variant: LookPieceData["variant"]): string {
    const parts: string[] = [];
    if (variant.gauge) parts.push(variant.gauge);
    if (variant.lengthMm) parts.push(`${variant.lengthMm}mm`);
    if (variant.materialFinish) parts.push(variant.materialFinish);
    if (variant.gemType && variant.gemType !== "none") {
        const gem = variant.gemColor ? `${variant.gemType} (${variant.gemColor})` : variant.gemType;
        parts.push(gem);
    }
    return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LookPieceRow({ piece }: LookPieceRowProps) {
    const specs = formatVariantSpecs(piece.variant);

    return (
        <div className={styles.pieceRow}>
            <div className={styles.pieceInfo}>
                <div className={styles.pieceHeader}>
                    <Link
                        href={`/catalog/${piece.product.handle}`}
                        className={styles.pieceProductTitle}
                    >
                        {piece.product.title}
                    </Link>
                    <span className={styles.piecePlacement}>{piece.piercingPointLabel}</span>
                </div>
                {specs && <span className={styles.pieceSpecs}>{specs}</span>}
            </div>
            <span className={styles.piecePrice}>{formatPrice(piece.variant.priceRub)}</span>
        </div>
    );
}
