"use server";

/**
 * Guest-cart server actions.
 *
 * The customer's cart lives in Zustand + localStorage on the client. These
 * actions add a server-side mirror keyed by the `pkzn_guest_cart` cookie so
 * a guest can:
 *
 *   - resume their cart on a different device by sharing the cookie token,
 *   - have the reservation server-action pre-populate `items` from the
 *     cookie token instead of trusting raw client input.
 *
 * Wire-up: `useReservationStore` (client) calls these actions on add/remove
 * with a debounce. The cookie is HttpOnly so JS can't read it — only the
 * server actions and route handlers can.
 */
import { cookies } from "next/headers";
import { z } from "zod";

import {
    GUEST_CART_COOKIE,
    buildCookieAttrs,
    buildExpiredCookieAttrs,
    clearCartByToken,
    generateGuestCartToken,
    guestCartItemSchema,
    loadCartByToken,
    mergeCartItems,
    normalizeCartItems,
    saveCartByToken,
    type GuestCart,
    type GuestCartItem,
} from "@/lib/cart/guest-cart";

import type { ActionResult } from "./auth";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const saveCartActionSchema = z.object({
    items: z.array(guestCartItemSchema).max(20),
    /** When `true`, the items are merged with the existing server cart
     *  (additive). When `false` (default), the server cart is replaced
     *  wholesale with `items`. */
    merge: z.boolean().optional().default(false),
});

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Read the current guest cart. Creates the cookie + token lazily on the
 * first call so a freshly-arrived visitor still gets a stable identifier
 * for subsequent saves.
 */
export async function loadGuestCartAction(): Promise<
    ActionResult<{ token: string; cart: GuestCart }>
> {
    try {
        const store = await cookies();
        let token = store.get(GUEST_CART_COOKIE)?.value;
        if (!token) {
            token = generateGuestCartToken();
            store.set(buildCookieAttrs(token));
        }
        const cart = await loadCartByToken(token);
        return { ok: true, data: { token, cart } };
    } catch (err) {
        console.error("[loadGuestCartAction] failed", err);
        return { ok: false, error: { code: "internal_error", message: "Ошибка сервера" } };
    }
}

/**
 * Persist (or merge) the cart. Returns the canonical post-write payload so
 * the client can sync localStorage with the server's normalized view.
 */
export async function saveGuestCartAction(
    raw: unknown
): Promise<ActionResult<{ token: string; cart: GuestCart }>> {
    const parsed = saveCartActionSchema.safeParse(raw);
    if (!parsed.success) {
        return {
            ok: false,
            error: {
                code: "validation_error",
                message: "Корзина содержит некорректные данные",
                details: parsed.error.issues.map((i) => ({
                    path: i.path.join("."),
                    message: i.message,
                })),
            },
        };
    }

    try {
        const store = await cookies();
        let token = store.get(GUEST_CART_COOKIE)?.value;
        if (!token) {
            token = generateGuestCartToken();
            store.set(buildCookieAttrs(token));
        }

        const incoming: GuestCartItem[] = parsed.data.items;
        const finalItems = parsed.data.merge
            ? mergeCartItems((await loadCartByToken(token)).items, incoming)
            : normalizeCartItems(incoming);

        const cart = await saveCartByToken(token, finalItems);
        return { ok: true, data: { token, cart } };
    } catch (err) {
        console.error("[saveGuestCartAction] failed", err);
        return { ok: false, error: { code: "internal_error", message: "Ошибка сервера" } };
    }
}

/**
 * Drop the cart from Redis and expire the cookie. Called after a
 * reservation confirms or when the customer hits "Очистить корзину".
 */
export async function clearGuestCartAction(): Promise<ActionResult<{ cleared: boolean }>> {
    try {
        const store = await cookies();
        const token = store.get(GUEST_CART_COOKIE)?.value;
        if (token) {
            await clearCartByToken(token);
        }
        store.set(buildExpiredCookieAttrs());
        return { ok: true, data: { cleared: true } };
    } catch (err) {
        console.error("[clearGuestCartAction] failed", err);
        return { ok: false, error: { code: "internal_error", message: "Ошибка сервера" } };
    }
}
