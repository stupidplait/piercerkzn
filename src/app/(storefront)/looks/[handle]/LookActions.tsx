"use client";

import { useCallback, useState } from "react";
import Link from "next/link";

import { useCartStore } from "@/stores/cart-store";

import styles from "./look-detail.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PieceForCart {
    variantId: string;
    productId: string;
    title: string;
    variantTitle: string;
    thumbnailUrl: string | null;
    unitPrice: number;
}

interface LookActionsProps {
    lookId: string;
    pieces: PieceForCart[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function LookActions({ lookId, pieces }: LookActionsProps) {
    const [addedConfirm, setAddedConfirm] = useState(false);
    const addItem = useCartStore((s) => s.addItem);

    const handleReserveLook = useCallback(() => {
        // Add all pieces to cart as individual items with look metadata
        for (const piece of pieces) {
            addItem({
                variantId: piece.variantId,
                productId: piece.productId,
                title: piece.title,
                variantTitle: piece.variantTitle,
                thumbnailUrl: piece.thumbnailUrl,
                unitPrice: piece.unitPrice,
                metadata: {
                    from: "look",
                    lookId,
                },
            });
        }

        setAddedConfirm(true);
        setTimeout(() => setAddedConfirm(false), 2000);
    }, [addItem, lookId, pieces]);

    return (
        <div className={styles.actionsSection}>
            <button
                type="button"
                className={`${styles.reserveBtn} ${addedConfirm ? styles.reserveBtnConfirm : ""}`}
                onClick={handleReserveLook}
                disabled={pieces.length === 0}
            >
                {addedConfirm ? "✓ Добавлено в корзину" : "Забронировать образ"}
            </button>

            <Link href={`/visualizer?look=${lookId}`} className={styles.tryOnLink}>
                <span className={styles.tryOnIcon}>◇</span>
                Примерить в 3D
            </Link>
        </div>
    );
}
