import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "@testing-library/react";

// Mock the server action before importing the store
vi.mock("@/actions/cart", () => ({
    saveGuestCartAction: vi
        .fn()
        .mockResolvedValue({
            ok: true,
            data: { token: "test", cart: { items: [], updatedAt: 0 } },
        }),
}));

import { useCartStore, type CartItem } from "./cart-store";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<CartItem> = {}) {
    return {
        variantId: overrides.variantId ?? crypto.randomUUID(),
        productId: overrides.productId ?? crypto.randomUUID(),
        title: overrides.title ?? "Test Product",
        variantTitle: overrides.variantTitle ?? "Gold 16g",
        thumbnailUrl: overrides.thumbnailUrl ?? null,
        unitPrice: overrides.unitPrice ?? 150000, // 1500 RUB in kopecks
        metadata: overrides.metadata,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cart-store", () => {
    beforeEach(() => {
        // Reset store state between tests
        act(() => {
            useCartStore.setState({ items: [] });
        });
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("addItem", () => {
        it("adds a new item with quantity 1 by default", () => {
            const item = makeItem();
            act(() => {
                useCartStore.getState().addItem(item);
            });

            const { items } = useCartStore.getState();
            expect(items).toHaveLength(1);
            expect(items[0].variantId).toBe(item.variantId);
            expect(items[0].quantity).toBe(1);
        });

        it("adds a new item with specified quantity", () => {
            const item = makeItem();
            act(() => {
                useCartStore.getState().addItem({ ...item, quantity: 5 });
            });

            const { items } = useCartStore.getState();
            expect(items[0].quantity).toBe(5);
        });

        it("clamps initial quantity to max 10", () => {
            const item = makeItem();
            act(() => {
                useCartStore.getState().addItem({ ...item, quantity: 15 });
            });

            const { items } = useCartStore.getState();
            expect(items[0].quantity).toBe(10);
        });

        it("clamps initial quantity to min 1", () => {
            const item = makeItem();
            act(() => {
                useCartStore.getState().addItem({ ...item, quantity: 0 });
            });

            const { items } = useCartStore.getState();
            expect(items[0].quantity).toBe(1);
        });

        it("deduplicates by variantId — increments quantity", () => {
            const variantId = crypto.randomUUID();
            const item = makeItem({ variantId });

            act(() => {
                useCartStore.getState().addItem(item);
                useCartStore.getState().addItem(item);
            });

            const { items } = useCartStore.getState();
            expect(items).toHaveLength(1);
            expect(items[0].quantity).toBe(2);
        });

        it("deduplication caps at 10", () => {
            const variantId = crypto.randomUUID();
            const item = makeItem({ variantId });

            act(() => {
                useCartStore.getState().addItem({ ...item, quantity: 8 });
                useCartStore.getState().addItem({ ...item, quantity: 5 });
            });

            const { items } = useCartStore.getState();
            expect(items[0].quantity).toBe(10);
        });

        it("preserves existing items when adding a new one", () => {
            const item1 = makeItem();
            const item2 = makeItem();

            act(() => {
                useCartStore.getState().addItem(item1);
                useCartStore.getState().addItem(item2);
            });

            const { items } = useCartStore.getState();
            expect(items).toHaveLength(2);
            expect(items[0].variantId).toBe(item1.variantId);
            expect(items[1].variantId).toBe(item2.variantId);
        });
    });

    describe("removeItem", () => {
        it("removes an item by variantId", () => {
            const item = makeItem();
            act(() => {
                useCartStore.getState().addItem(item);
                useCartStore.getState().removeItem(item.variantId);
            });

            expect(useCartStore.getState().items).toHaveLength(0);
        });

        it("does not affect other items", () => {
            const item1 = makeItem();
            const item2 = makeItem();

            act(() => {
                useCartStore.getState().addItem(item1);
                useCartStore.getState().addItem(item2);
                useCartStore.getState().removeItem(item1.variantId);
            });

            const { items } = useCartStore.getState();
            expect(items).toHaveLength(1);
            expect(items[0].variantId).toBe(item2.variantId);
        });
    });

    describe("updateQuantity", () => {
        it("updates quantity for a given variantId", () => {
            const item = makeItem();
            act(() => {
                useCartStore.getState().addItem(item);
                useCartStore.getState().updateQuantity(item.variantId, 7);
            });

            expect(useCartStore.getState().items[0].quantity).toBe(7);
        });

        it("clamps quantity to max 10", () => {
            const item = makeItem();
            act(() => {
                useCartStore.getState().addItem(item);
                useCartStore.getState().updateQuantity(item.variantId, 99);
            });

            expect(useCartStore.getState().items[0].quantity).toBe(10);
        });

        it("clamps quantity to min 1", () => {
            const item = makeItem();
            act(() => {
                useCartStore.getState().addItem(item);
                useCartStore.getState().updateQuantity(item.variantId, 0);
            });

            expect(useCartStore.getState().items[0].quantity).toBe(1);
        });

        it("does not affect other items", () => {
            const item1 = makeItem();
            const item2 = makeItem();
            act(() => {
                useCartStore.getState().addItem({ ...item1, quantity: 3 });
                useCartStore.getState().addItem({ ...item2, quantity: 5 });
                useCartStore.getState().updateQuantity(item1.variantId, 8);
            });

            const { items } = useCartStore.getState();
            expect(items[0].quantity).toBe(8);
            expect(items[1].quantity).toBe(5);
        });
    });

    describe("clearCart", () => {
        it("removes all items", () => {
            act(() => {
                useCartStore.getState().addItem(makeItem());
                useCartStore.getState().addItem(makeItem());
                useCartStore.getState().clearCart();
            });

            expect(useCartStore.getState().items).toHaveLength(0);
        });
    });

    describe("totalItems", () => {
        it("returns 0 for empty cart", () => {
            expect(useCartStore.getState().totalItems()).toBe(0);
        });

        it("returns sum of all quantities", () => {
            act(() => {
                useCartStore.getState().addItem({ ...makeItem(), quantity: 3 });
                useCartStore.getState().addItem({ ...makeItem(), quantity: 5 });
            });

            expect(useCartStore.getState().totalItems()).toBe(8);
        });
    });

    describe("totalPrice", () => {
        it("returns 0 for empty cart", () => {
            expect(useCartStore.getState().totalPrice()).toBe(0);
        });

        it("returns sum of unitPrice * quantity for all items", () => {
            act(() => {
                useCartStore
                    .getState()
                    .addItem({ ...makeItem({ unitPrice: 100000 }), quantity: 2 });
                useCartStore.getState().addItem({ ...makeItem({ unitPrice: 50000 }), quantity: 3 });
            });

            // 100000*2 + 50000*3 = 200000 + 150000 = 350000
            expect(useCartStore.getState().totalPrice()).toBe(350000);
        });
    });

    describe("server sync (debounced)", () => {
        it("calls saveGuestCartAction after 1s debounce on addItem", async () => {
            const { saveGuestCartAction } = await import("@/actions/cart");

            act(() => {
                useCartStore.getState().addItem(makeItem());
            });

            // Not called immediately
            expect(saveGuestCartAction).not.toHaveBeenCalled();

            // Advance past debounce
            await act(async () => {
                vi.advanceTimersByTime(1000);
            });

            expect(saveGuestCartAction).toHaveBeenCalledTimes(1);
        });

        it("debounces multiple rapid mutations into one sync", async () => {
            const { saveGuestCartAction } = await import("@/actions/cart");
            vi.mocked(saveGuestCartAction).mockClear();

            act(() => {
                useCartStore.getState().addItem(makeItem());
                useCartStore.getState().addItem(makeItem());
                useCartStore.getState().addItem(makeItem());
            });

            await act(async () => {
                vi.advanceTimersByTime(1000);
            });

            // Only one call despite 3 mutations
            expect(saveGuestCartAction).toHaveBeenCalledTimes(1);
        });
    });
});
