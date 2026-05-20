"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { saveGuestCartAction } from "@/actions/cart";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CartItem {
    variantId: string;
    productId: string;
    title: string;
    variantTitle: string;
    thumbnailUrl: string | null;
    unitPrice: number; // kopecks
    quantity: number; // 1–10
    metadata?: {
        from?: "catalog" | "visualizer" | "look" | "telegram";
        lookId?: string;
    };
}

export interface CartStore {
    items: CartItem[];
    // Actions
    addItem: (item: Omit<CartItem, "quantity"> & { quantity?: number }) => void;
    removeItem: (variantId: string) => void;
    updateQuantity: (variantId: string, quantity: number) => void;
    clearCart: () => void;
    // Derived
    totalItems: () => number;
    totalPrice: () => number;
    // Server sync
    syncToServer: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 10;
const DEBOUNCE_MS = 1000;
const STORAGE_KEY = "pkzn_cart";

// ---------------------------------------------------------------------------
// Debounce helper
// ---------------------------------------------------------------------------

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function debouncedSync(syncFn: () => Promise<void>) {
    if (debounceTimer) {
        clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        syncFn();
    }, DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useCartStore = create<CartStore>()(
    persist(
        (set, get) => ({
            items: [],

            addItem: (item) => {
                set((state) => {
                    const existing = state.items.find((i) => i.variantId === item.variantId);

                    if (existing) {
                        // Deduplication: increment quantity, capped at MAX_QUANTITY
                        return {
                            items: state.items.map((i) =>
                                i.variantId === item.variantId
                                    ? {
                                          ...i,
                                          quantity: Math.min(
                                              i.quantity + (item.quantity ?? 1),
                                              MAX_QUANTITY
                                          ),
                                          metadata: item.metadata ?? i.metadata,
                                      }
                                    : i
                            ),
                        };
                    }

                    // New item: clamp quantity to bounds
                    const quantity = Math.max(
                        MIN_QUANTITY,
                        Math.min(item.quantity ?? 1, MAX_QUANTITY)
                    );

                    return {
                        items: [
                            ...state.items,
                            {
                                variantId: item.variantId,
                                productId: item.productId,
                                title: item.title,
                                variantTitle: item.variantTitle,
                                thumbnailUrl: item.thumbnailUrl,
                                unitPrice: item.unitPrice,
                                quantity,
                                metadata: item.metadata,
                            },
                        ],
                    };
                });

                debouncedSync(() => get().syncToServer());
            },

            removeItem: (variantId) => {
                set((state) => ({
                    items: state.items.filter((i) => i.variantId !== variantId),
                }));

                debouncedSync(() => get().syncToServer());
            },

            updateQuantity: (variantId, quantity) => {
                const clamped = Math.max(MIN_QUANTITY, Math.min(quantity, MAX_QUANTITY));

                set((state) => ({
                    items: state.items.map((i) =>
                        i.variantId === variantId ? { ...i, quantity: clamped } : i
                    ),
                }));

                debouncedSync(() => get().syncToServer());
            },

            clearCart: () => {
                set({ items: [] });
                debouncedSync(() => get().syncToServer());
            },

            totalItems: () => {
                return get().items.reduce((sum, item) => sum + item.quantity, 0);
            },

            totalPrice: () => {
                return get().items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
            },

            syncToServer: async () => {
                const { items } = get();
                try {
                    await saveGuestCartAction({
                        items: items.map((item) => ({
                            variantId: item.variantId,
                            quantity: item.quantity,
                            metadata: item.metadata,
                        })),
                        merge: false,
                    });
                } catch {
                    // Non-blocking: local state is preserved on failure.
                    // The cart page will show a toast if needed.
                    console.warn("[cart-store] server sync failed");
                }
            },
        }),
        {
            name: STORAGE_KEY,
            partialize: (state) => ({ items: state.items }),
        }
    )
);
