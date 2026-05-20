"use client";

import { useCallback, useState } from "react";

import { useCartStore } from "@/stores/cart-store";

import styles from "./product-detail.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Variant {
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

interface VariantSelectorProps {
    productId: string;
    productTitle: string;
    thumbnailUrl: string | null;
    variants: Variant[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(kopecks: number): string {
    const rub = Math.floor(kopecks);
    return new Intl.NumberFormat("ru-RU").format(rub) + " ₽";
}

function formatVariantSpecs(variant: Variant): string {
    const parts: string[] = [];
    if (variant.gauge) parts.push(variant.gauge);
    if (variant.lengthMm) parts.push(`${variant.lengthMm}mm`);
    if (variant.diameterMm) parts.push(`⌀${variant.diameterMm}mm`);
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

export function VariantSelector({
    productId,
    productTitle,
    thumbnailUrl,
    variants,
}: VariantSelectorProps) {
    const [selectedId, setSelectedId] = useState<string>(variants[0]?.id ?? "");
    const [addedConfirm, setAddedConfirm] = useState(false);
    const addItem = useCartStore((s) => s.addItem);

    const selectedVariant = variants.find((v) => v.id === selectedId) ?? variants[0];
    const isSingleVariant = variants.length === 1;

    const handleAddToCart = useCallback(() => {
        if (!selectedVariant) return;

        addItem({
            variantId: selectedVariant.id,
            productId,
            title: productTitle,
            variantTitle: selectedVariant.title,
            thumbnailUrl: selectedVariant.imageUrl || thumbnailUrl,
            unitPrice: selectedVariant.priceRub,
            metadata: { from: "catalog" },
        });

        setAddedConfirm(true);
        setTimeout(() => setAddedConfirm(false), 300);
    }, [selectedVariant, addItem, productId, productTitle, thumbnailUrl]);

    if (variants.length === 0) {
        return (
            <div className={styles.variantSection}>
                <p className={styles.noVariants}>Нет доступных вариантов</p>
            </div>
        );
    }

    return (
        <div className={styles.variantSection}>
            {/* Price display */}
            <div className={styles.priceDisplay}>
                <span className={styles.price}>{formatPrice(selectedVariant.priceRub)}</span>
                {(selectedVariant.inventoryQuantity ?? 0) > 0 && (
                    <span className={styles.stockIndicator} data-in-stock="1">
                        В наличии
                    </span>
                )}
                {(selectedVariant.inventoryQuantity ?? 0) === 0 && (
                    <span className={styles.stockIndicator} data-in-stock="0">
                        Под заказ
                    </span>
                )}
            </div>

            {/* Variant selector (only if multiple variants) */}
            {!isSingleVariant && (
                <div className={styles.variantList} role="radiogroup" aria-label="Выбор варианта">
                    {variants.map((variant) => (
                        <button
                            key={variant.id}
                            type="button"
                            role="radio"
                            aria-checked={variant.id === selectedId}
                            className={`${styles.variantOption} ${variant.id === selectedId ? styles.variantOptionActive : ""}`}
                            onClick={() => setSelectedId(variant.id)}
                        >
                            <span className={styles.variantTitle}>{variant.title}</span>
                            <span className={styles.variantSpecs}>
                                {formatVariantSpecs(variant)}
                            </span>
                            <span className={styles.variantPrice}>
                                {formatPrice(variant.priceRub)}
                            </span>
                        </button>
                    ))}
                </div>
            )}

            {/* Single variant specs display */}
            {isSingleVariant && (
                <div className={styles.singleVariantSpecs}>
                    <span className={styles.variantSpecs}>
                        {formatVariantSpecs(selectedVariant)}
                    </span>
                </div>
            )}

            {/* Add to cart button */}
            <button
                type="button"
                className={`${styles.addToCartBtn} ${addedConfirm ? styles.addToCartBtnConfirm : ""}`}
                onClick={handleAddToCart}
            >
                {addedConfirm ? "✓ Добавлено" : "Добавить в корзину"}
            </button>
        </div>
    );
}
