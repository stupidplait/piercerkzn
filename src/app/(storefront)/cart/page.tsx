"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { useCartStore, type CartItem } from "@/stores/cart-store";

import styles from "./cart.module.css";

// ---------------------------------------------------------------------------
// Price formatting helper
// ---------------------------------------------------------------------------

function formatPrice(kopecks: number): string {
    const rubles = kopecks / 100;
    return rubles.toLocaleString("ru-RU", {
        style: "currency",
        currency: "RUB",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    });
}

// ---------------------------------------------------------------------------
// CartItemRow Component
// ---------------------------------------------------------------------------

interface CartItemRowProps {
    item: CartItem;
    onIncrement: (variantId: string) => void;
    onDecrement: (variantId: string) => void;
    onRemove: (variantId: string) => void;
}

function CartItemRow({ item, onIncrement, onDecrement, onRemove }: CartItemRowProps) {
    return (
        <div className={styles.itemRow}>
            {/* Thumbnail */}
            {item.thumbnailUrl ? (
                <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    className={styles.itemThumbnail}
                    loading="lazy"
                />
            ) : (
                <div className={styles.itemThumbnailPlaceholder} aria-hidden="true">
                    —
                </div>
            )}

            {/* Info */}
            <div className={styles.itemInfo}>
                <h3 className={styles.itemTitle}>{item.title}</h3>
                <span className={styles.itemVariant}>{item.variantTitle}</span>
                <span className={styles.itemPrice}>{formatPrice(item.unitPrice)}</span>
            </div>

            {/* Controls */}
            <div className={styles.itemControls}>
                <div className={styles.quantityControls}>
                    <button
                        type="button"
                        className={styles.quantityBtn}
                        onClick={() => onDecrement(item.variantId)}
                        aria-label={
                            item.quantity === 1
                                ? `Удалить ${item.title} из корзины`
                                : `Уменьшить количество ${item.title}`
                        }
                    >
                        −
                    </button>
                    <span className={styles.quantityValue} aria-live="polite">
                        {item.quantity}
                    </span>
                    <button
                        type="button"
                        className={styles.quantityBtn}
                        onClick={() => onIncrement(item.variantId)}
                        disabled={item.quantity >= 10}
                        aria-label={`Увеличить количество ${item.title}`}
                    >
                        +
                    </button>
                </div>

                <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => onRemove(item.variantId)}
                    aria-label={`Удалить ${item.title} из корзины`}
                >
                    ✕
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// CartSummary Component
// ---------------------------------------------------------------------------

interface CartSummaryProps {
    totalPrice: number;
    totalItems: number;
    isEmpty: boolean;
}

function CartSummary({ totalPrice, totalItems, isEmpty }: CartSummaryProps) {
    return (
        <aside className={styles.summaryPanel} aria-label="Итого по корзине">
            <h2 className={styles.summaryTitle}>Итого</h2>

            <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>
                    {totalItems} {getPluralForm(totalItems, "товар", "товара", "товаров")}
                </span>
                <span className={styles.summaryValue}>{formatPrice(totalPrice)}</span>
            </div>

            <hr className={styles.summaryDivider} />

            {isEmpty ? (
                <button type="button" className={styles.checkoutBtn} disabled>
                    Оформить бронь
                </button>
            ) : (
                <Link href="/reservation/confirm" className={styles.checkoutBtn}>
                    Оформить бронь
                </Link>
            )}
        </aside>
    );
}

// ---------------------------------------------------------------------------
// Plural helper
// ---------------------------------------------------------------------------

function getPluralForm(n: number, one: string, few: string, many: string): string {
    const abs = Math.abs(n) % 100;
    const lastDigit = abs % 10;
    if (abs > 10 && abs < 20) return many;
    if (lastDigit > 1 && lastDigit < 5) return few;
    if (lastDigit === 1) return one;
    return many;
}

// ---------------------------------------------------------------------------
// Cart Page
// ---------------------------------------------------------------------------

export default function CartPage() {
    const items = useCartStore((s) => s.items);
    const updateQuantity = useCartStore((s) => s.updateQuantity);
    const removeItem = useCartStore((s) => s.removeItem);
    const totalPrice = useCartStore((s) => s.totalPrice);
    const totalItems = useCartStore((s) => s.totalItems);
    const syncToServer = useCartStore((s) => s.syncToServer);

    const [syncError, setSyncError] = useState(false);
    const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Set page title
    useEffect(() => {
        document.title = "Корзина — PiercerKZN";
    }, []);

    // Server sync with debounce (1s) on mutations
    // The store already debounces internally, but we also handle error display here
    const triggerSync = useCallback(() => {
        if (syncTimerRef.current) {
            clearTimeout(syncTimerRef.current);
        }
        syncTimerRef.current = setTimeout(async () => {
            try {
                await syncToServer();
                setSyncError(false);
            } catch {
                setSyncError(true);
                // Auto-dismiss after 4s
                setTimeout(() => setSyncError(false), 4000);
            }
        }, 1000);
    }, [syncToServer]);

    // Cleanup timer on unmount
    useEffect(() => {
        return () => {
            if (syncTimerRef.current) {
                clearTimeout(syncTimerRef.current);
            }
        };
    }, []);

    const handleIncrement = useCallback(
        (variantId: string) => {
            const item = items.find((i) => i.variantId === variantId);
            if (item && item.quantity < 10) {
                updateQuantity(variantId, item.quantity + 1);
                triggerSync();
            }
        },
        [items, updateQuantity, triggerSync]
    );

    const handleDecrement = useCallback(
        (variantId: string) => {
            const item = items.find((i) => i.variantId === variantId);
            if (!item) return;

            if (item.quantity === 1) {
                // Decrement at quantity 1 removes item
                removeItem(variantId);
            } else {
                updateQuantity(variantId, item.quantity - 1);
            }
            triggerSync();
        },
        [items, updateQuantity, removeItem, triggerSync]
    );

    const handleRemove = useCallback(
        (variantId: string) => {
            removeItem(variantId);
            triggerSync();
        },
        [removeItem, triggerSync]
    );

    const isEmpty = items.length === 0;

    return (
        <div className={styles.cartPage}>
            <header className={styles.cartHeader}>
                <h1 className={styles.cartTitle}>Корзина</h1>
                {!isEmpty && (
                    <p className={styles.cartSubtitle}>
                        Проверьте выбранные украшения перед оформлением брони
                    </p>
                )}
            </header>

            {isEmpty ? (
                <div className={styles.emptyState}>
                    <div className={styles.emptyStateIcon} aria-hidden="true">
                        ◇
                    </div>
                    <h2 className={styles.emptyStateTitle}>Корзина пуста</h2>
                    <p className={styles.emptyStateText}>
                        Добавьте украшения из каталога, чтобы оформить бронь
                    </p>
                    <Link href="/catalog" className={styles.emptyStateLink}>
                        Перейти в каталог
                    </Link>
                </div>
            ) : (
                <div className={styles.cartContent}>
                    <div className={styles.itemsList} role="list" aria-label="Товары в корзине">
                        {items.map((item) => (
                            <CartItemRow
                                key={item.variantId}
                                item={item}
                                onIncrement={handleIncrement}
                                onDecrement={handleDecrement}
                                onRemove={handleRemove}
                            />
                        ))}
                    </div>

                    <CartSummary
                        totalPrice={totalPrice()}
                        totalItems={totalItems()}
                        isEmpty={isEmpty}
                    />
                </div>
            )}

            {/* Non-blocking sync error toast */}
            {syncError && (
                <div className={styles.syncError} role="alert" aria-live="polite">
                    Не удалось синхронизировать корзину с сервером
                </div>
            )}
        </div>
    );
}
