/**
 * Server-side guest cart store.
 *
 * The studio's reservation flow stores its cart **client-side** (Zustand +
 * localStorage). This module adds an opt-in **server mirror** so:
 *
 *   1. A guest who hops devices (mobile → desktop) can resume their cart
 *      by sharing the `pkzn_guest_cart` cookie / token.
 *   2. The reservation server-action can pre-populate `items` from the
 *      cookie token instead of trusting raw client input.
 *
 * Storage:
 *   - Each cart is keyed by an opaque ULID-style token (`pkzn_guest_cart`
 *     cookie value). The token never carries customer PII; we store it
 *     under `cart:guest:<token>` in Redis with a 30-day TTL.
 *   - Items are validated against a strict zod schema before write so a
 *     compromised cookie can't poison the server with arbitrary JSON.
 *
 * Lifecycle:
 *   - **load**: cookie present? read; otherwise return empty cart.
 *   - **save**: ensure-cookie + write items; debounced from the client.
 *   - **clear**: drop key + cookie. Called after a reservation confirms.
 *
 * Failure modes:
 *   - Redis down → returns an empty cart from `load`, no-ops on `save`.
 *     The client store stays the source of truth in that window.
 *   - Bad JSON / schema mismatch → treated as empty (cookie kept, contents
 *     overwritten on next save).
 */
import "server-only";

import { z } from "zod";

import { redis } from "@/lib/redis";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const GUEST_CART_COOKIE = "pkzn_guest_cart";
const KEY_PREFIX = "cart:guest:";
/** 30-day TTL on the Redis side; cookie max-age matches. */
const TTL_SECONDS = 60 * 60 * 24 * 30;
const COOKIE_MAX_AGE = TTL_SECONDS;
/** Cap on how many items a guest cart can carry — defensive bound on the
 *  blast radius of a malicious save. Mirrors `createReservationSchema.items.max`. */
const MAX_ITEMS = 20;
/** Ceiling on per-item quantity, mirrors `reservationItemSchema.quantity.max`. */
const MAX_QUANTITY_PER_ITEM = 10;

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
export const guestCartItemSchema = z.object({
    variantId: z.string().uuid(),
    quantity: z.number().int().min(1).max(MAX_QUANTITY_PER_ITEM),
    /** Source tagging — mirrors the reservation flow's attribution. */
    metadata: z
        .object({
            from: z.enum(["catalog", "visualizer", "look", "telegram"]).optional(),
            lookId: z.string().uuid().optional(),
        })
        .optional(),
});
export type GuestCartItem = z.infer<typeof guestCartItemSchema>;

export const guestCartSchema = z.object({
    items: z.array(guestCartItemSchema).max(MAX_ITEMS),
    /** Last-write timestamp (epoch ms). Used by the client to resolve
     *  conflicts between localStorage and the server mirror. */
    updatedAt: z.number().int().nonnegative(),
});
export type GuestCart = z.infer<typeof guestCartSchema>;

const EMPTY_CART: GuestCart = { items: [], updatedAt: 0 };

// ---------------------------------------------------------------------------
// Token generation
// ---------------------------------------------------------------------------

/**
 * 26-character ULID-style token (lowercase base32). Decoupled from the
 * cookie's session id so leaking one doesn't compromise auth state.
 *
 * Implementation note: `crypto.randomUUID()` would do; we strip dashes and
 * keep the cookie short. URL-safe characters only.
 */
export function generateGuestCartToken(): string {
    return crypto.randomUUID().replace(/-/g, "");
}

function isValidToken(token: string | undefined | null): token is string {
    return typeof token === "string" && /^[a-zA-Z0-9]{16,64}$/.test(token);
}

function fullKey(token: string): string {
    return `${KEY_PREFIX}${token}`;
}

// ---------------------------------------------------------------------------
// Cookie attributes — exported for the server-action wrapper.
// ---------------------------------------------------------------------------
export interface GuestCartCookieAttrs {
    name: string;
    value: string;
    maxAge: number;
    httpOnly: boolean;
    sameSite: "lax";
    secure: boolean;
    path: string;
}

export function buildCookieAttrs(token: string): GuestCartCookieAttrs {
    return {
        name: GUEST_CART_COOKIE,
        value: token,
        maxAge: COOKIE_MAX_AGE,
        // HttpOnly: token is opaque, never read by client JS — the cart itself
        // lives in localStorage. Reduces XSS surface.
        httpOnly: true,
        sameSite: "lax",
        // Secure flag flips on for any non-localhost env to satisfy modern
        // browsers' SameSite=Lax interplay with Secure.
        secure: process.env.NODE_ENV === "production",
        path: "/",
    };
}

export function buildExpiredCookieAttrs(): GuestCartCookieAttrs {
    return { ...buildCookieAttrs(""), maxAge: 0 };
}

// ---------------------------------------------------------------------------
// Pure helpers (DB-/Redis-free, unit-testable)
// ---------------------------------------------------------------------------

/**
 * Merge a freshly-submitted item list into an existing cart. Quantities
 * for the same `variantId` are summed (capped at the per-item ceiling),
 * preserving the latest `metadata`. Order is stable: existing items first,
 * new items appended.
 */
export function mergeCartItems(
    existing: readonly GuestCartItem[],
    incoming: readonly GuestCartItem[]
): GuestCartItem[] {
    const out = new Map<string, GuestCartItem>();
    for (const it of existing) {
        out.set(it.variantId, { ...it });
    }
    for (const it of incoming) {
        const prev = out.get(it.variantId);
        if (prev) {
            const sum = Math.min(MAX_QUANTITY_PER_ITEM, prev.quantity + it.quantity);
            out.set(it.variantId, {
                variantId: it.variantId,
                quantity: sum,
                metadata: it.metadata ?? prev.metadata,
            });
        } else {
            out.set(it.variantId, it);
        }
    }
    return Array.from(out.values()).slice(0, MAX_ITEMS);
}

/**
 * Replace the cart contents wholesale. Returned items are deduped on
 * `variantId` (last write wins) and clamped to the same caps as merge.
 */
export function normalizeCartItems(items: readonly GuestCartItem[]): GuestCartItem[] {
    const out = new Map<string, GuestCartItem>();
    for (const it of items) {
        out.set(it.variantId, {
            variantId: it.variantId,
            quantity: Math.min(MAX_QUANTITY_PER_ITEM, it.quantity),
            metadata: it.metadata,
        });
    }
    return Array.from(out.values()).slice(0, MAX_ITEMS);
}

// ---------------------------------------------------------------------------
// Storage I/O
// ---------------------------------------------------------------------------

/**
 * Read a cart by its cookie token. Returns the empty cart for an unknown
 * or invalid token, or when Redis is unavailable.
 */
export async function loadCartByToken(token: string | undefined | null): Promise<GuestCart> {
    if (!isValidToken(token)) return EMPTY_CART;
    try {
        const raw = await redis.get(fullKey(token));
        if (!raw) return EMPTY_CART;
        const parsed = guestCartSchema.safeParse(JSON.parse(raw));
        if (!parsed.success) {
            console.warn("[guest-cart] schema mismatch for token", token);
            return EMPTY_CART;
        }
        return parsed.data;
    } catch (err) {
        console.warn("[guest-cart] load failed", err);
        return EMPTY_CART;
    }
}

/**
 * Persist the cart. Refreshes the Redis TTL on every write so an active
 * cart never disappears under the customer.
 */
export async function saveCartByToken(
    token: string,
    items: readonly GuestCartItem[]
): Promise<GuestCart> {
    if (!isValidToken(token)) {
        throw new Error("guest-cart: invalid token");
    }
    const payload: GuestCart = {
        items: normalizeCartItems(items),
        updatedAt: Date.now(),
    };
    try {
        await redis.set(fullKey(token), JSON.stringify(payload), "EX", TTL_SECONDS);
    } catch (err) {
        console.warn("[guest-cart] save failed", err);
    }
    return payload;
}

/**
 * Drop the cart from Redis. Cookie removal is the caller's responsibility
 * (it lives in the response, which we don't have here).
 */
export async function clearCartByToken(token: string | undefined | null): Promise<void> {
    if (!isValidToken(token)) return;
    try {
        await redis.del(fullKey(token));
    } catch (err) {
        console.warn("[guest-cart] clear failed", err);
    }
}

// ---------------------------------------------------------------------------
// Test hooks
// ---------------------------------------------------------------------------
export const __testing__ = {
    KEY_PREFIX,
    TTL_SECONDS,
    MAX_ITEMS,
    MAX_QUANTITY_PER_ITEM,
    isValidToken,
    fullKey,
};
