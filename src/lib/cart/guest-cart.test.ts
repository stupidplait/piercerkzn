import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted in-memory Redis double — same shape as the cache test mock,
// just simpler (only `get`, `set`, `del`).
const { fakeRedis } = vi.hoisted(() => {
    const store = new Map<string, { value: string; expiresAt: number | null }>();
    const inst = {
        store,
        async get(key: string): Promise<string | null> {
            const e = store.get(key);
            if (!e) return null;
            if (e.expiresAt !== null && e.expiresAt <= Date.now()) {
                store.delete(key);
                return null;
            }
            return e.value;
        },
        async set(key: string, value: string, _mode?: "EX", ttl?: number): Promise<"OK"> {
            const expiresAt = ttl ? Date.now() + ttl * 1000 : null;
            store.set(key, { value, expiresAt });
            return "OK";
        },
        async del(...keys: string[]): Promise<number> {
            let n = 0;
            for (const k of keys) if (store.delete(k)) n += 1;
            return n;
        },
    };
    return { fakeRedis: inst };
});

vi.mock("@/lib/redis", () => ({ redis: fakeRedis }));

import {
    GUEST_CART_COOKIE,
    __testing__,
    buildCookieAttrs,
    buildExpiredCookieAttrs,
    clearCartByToken,
    generateGuestCartToken,
    loadCartByToken,
    mergeCartItems,
    normalizeCartItems,
    saveCartByToken,
    type GuestCartItem,
} from "./guest-cart";

beforeEach(() => {
    fakeRedis.store.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("guest-cart — generateGuestCartToken", () => {
    it("produces a 32-char hex-ish identifier", () => {
        const t = generateGuestCartToken();
        expect(t).toMatch(/^[a-zA-Z0-9]{16,64}$/);
        expect(t.length).toBe(32);
    });

    it("is unique on consecutive calls", () => {
        const a = generateGuestCartToken();
        const b = generateGuestCartToken();
        expect(a).not.toBe(b);
    });
});

describe("guest-cart — isValidToken", () => {
    it("rejects empty / short / non-hex tokens", () => {
        expect(__testing__.isValidToken(undefined)).toBe(false);
        expect(__testing__.isValidToken(null)).toBe(false);
        expect(__testing__.isValidToken("")).toBe(false);
        expect(__testing__.isValidToken("short")).toBe(false);
        expect(__testing__.isValidToken("contains-dashes-which-are-bad")).toBe(false);
    });

    it("accepts a freshly generated token", () => {
        const t = generateGuestCartToken();
        expect(__testing__.isValidToken(t)).toBe(true);
    });
});

// Valid RFC 4122 v4 UUIDs (the variant nibble must be 8/9/a/b).
const A: GuestCartItem = {
    variantId: "11111111-1111-4111-8111-111111111111",
    quantity: 2,
};
const B: GuestCartItem = {
    variantId: "22222222-2222-4222-9222-222222222222",
    quantity: 1,
};

describe("guest-cart — mergeCartItems", () => {
    it("appends new items in order", () => {
        const out = mergeCartItems([A], [B]);
        expect(out.map((i) => i.variantId)).toEqual([A.variantId, B.variantId]);
    });

    it("sums quantities for the same variant", () => {
        const out = mergeCartItems([A], [{ ...A, quantity: 3 }]);
        expect(out).toHaveLength(1);
        expect(out[0].quantity).toBe(5);
    });

    it("clamps summed quantity to per-item ceiling", () => {
        const out = mergeCartItems([{ ...A, quantity: 8 }], [{ ...A, quantity: 5 }]);
        expect(out[0].quantity).toBe(__testing__.MAX_QUANTITY_PER_ITEM);
    });

    it("trims to MAX_ITEMS", () => {
        const many = Array.from({ length: 25 }, (_, i) => ({
            variantId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
            quantity: 1,
        }));
        const out = mergeCartItems([], many);
        expect(out).toHaveLength(__testing__.MAX_ITEMS);
    });

    it("prefers incoming metadata over existing", () => {
        const out = mergeCartItems(
            [{ ...A, metadata: { from: "catalog" } }],
            [{ ...A, metadata: { from: "visualizer" } }]
        );
        expect(out[0].metadata?.from).toBe("visualizer");
    });
});

describe("guest-cart — normalizeCartItems", () => {
    it("dedupes by variantId, last write wins", () => {
        const out = normalizeCartItems([A, { ...A, quantity: 9 }]);
        expect(out).toHaveLength(1);
        expect(out[0].quantity).toBe(9);
    });

    it("clamps per-item quantity to ceiling", () => {
        const out = normalizeCartItems([{ ...A, quantity: 999 }]);
        expect(out[0].quantity).toBe(__testing__.MAX_QUANTITY_PER_ITEM);
    });

    it("trims to MAX_ITEMS", () => {
        const many = Array.from({ length: 30 }, (_, i) => ({
            variantId: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`,
            quantity: 1,
        }));
        expect(normalizeCartItems(many)).toHaveLength(__testing__.MAX_ITEMS);
    });
});

describe("guest-cart — Redis I/O", () => {
    it("loadCartByToken returns empty for unknown token", async () => {
        const cart = await loadCartByToken("a".repeat(32));
        expect(cart.items).toEqual([]);
        expect(cart.updatedAt).toBe(0);
    });

    it("loadCartByToken returns empty for invalid token", async () => {
        const cart = await loadCartByToken("nope-too-short");
        expect(cart.items).toEqual([]);
    });

    it("saveCartByToken + loadCartByToken round-trip", async () => {
        const t = generateGuestCartToken();
        const saved = await saveCartByToken(t, [A, B]);
        expect(saved.items).toHaveLength(2);
        expect(saved.updatedAt).toBeGreaterThan(0);

        const reloaded = await loadCartByToken(t);
        expect(reloaded.items.map((i) => i.variantId).sort()).toEqual(
            [A.variantId, B.variantId].sort()
        );
    });

    it("saveCartByToken normalizes (dedupe + clamp) before writing", async () => {
        const t = generateGuestCartToken();
        await saveCartByToken(t, [A, { ...A, quantity: 5 }, { ...B, quantity: 999 }]);
        const reloaded = await loadCartByToken(t);
        expect(reloaded.items).toHaveLength(2);
        const aOut = reloaded.items.find((i) => i.variantId === A.variantId)!;
        const bOut = reloaded.items.find((i) => i.variantId === B.variantId)!;
        expect(aOut.quantity).toBe(5);
        expect(bOut.quantity).toBe(__testing__.MAX_QUANTITY_PER_ITEM);
    });

    it("saveCartByToken throws on invalid token", async () => {
        await expect(saveCartByToken("bad", [A])).rejects.toThrow(/invalid token/);
    });

    it("loadCartByToken returns empty when payload is corrupted", async () => {
        const t = generateGuestCartToken();
        fakeRedis.store.set(__testing__.fullKey(t), {
            value: "{not json",
            expiresAt: null,
        });
        const cart = await loadCartByToken(t);
        expect(cart.items).toEqual([]);
    });

    it("clearCartByToken removes the entry", async () => {
        const t = generateGuestCartToken();
        await saveCartByToken(t, [A]);
        await clearCartByToken(t);
        const reloaded = await loadCartByToken(t);
        expect(reloaded.items).toEqual([]);
    });

    it("clearCartByToken is a no-op for invalid tokens", async () => {
        await expect(clearCartByToken("nope")).resolves.toBeUndefined();
    });
});

describe("guest-cart — cookie attributes", () => {
    it("buildCookieAttrs uses the canonical cookie name + 30d max-age", () => {
        const a = buildCookieAttrs("token123");
        expect(a.name).toBe(GUEST_CART_COOKIE);
        expect(a.value).toBe("token123");
        expect(a.maxAge).toBe(__testing__.TTL_SECONDS);
        expect(a.httpOnly).toBe(true);
        expect(a.sameSite).toBe("lax");
        expect(a.path).toBe("/");
    });

    it("buildExpiredCookieAttrs zeroes max-age", () => {
        expect(buildExpiredCookieAttrs().maxAge).toBe(0);
    });
});
