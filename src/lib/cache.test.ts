import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.mock` hoists to the top of the file, so any state referenced inside
// the factory must come from `vi.hoisted()` (which also hoists). The fake
// Redis double is therefore defined entirely inside the hoisted factory.
const { fakeRedis } = vi.hoisted(() => {
    type Entry = { value: string; expiresAt: number | null };
    const store = new Map<string, Entry>();
    const state = { failGet: false, failSet: false };
    const inst = {
        store,
        get failGet() {
            return state.failGet;
        },
        set failGet(v: boolean) {
            state.failGet = v;
        },
        get failSet() {
            return state.failSet;
        },
        set failSet(v: boolean) {
            state.failSet = v;
        },
        async get(key: string): Promise<string | null> {
            if (state.failGet) throw new Error("redis down");
            const entry = store.get(key);
            if (!entry) return null;
            if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
                store.delete(key);
                return null;
            }
            return entry.value;
        },
        async set(key: string, value: string, _mode?: "EX", ttlSeconds?: number): Promise<"OK"> {
            if (state.failSet) throw new Error("redis down");
            const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
            store.set(key, { value, expiresAt });
            return "OK";
        },
        async del(...keys: string[]): Promise<number> {
            let n = 0;
            for (const k of keys) if (store.delete(k)) n += 1;
            return n;
        },
        async mget(...keys: string[]): Promise<(string | null)[]> {
            return Promise.all(keys.map((k) => inst.get(k)));
        },
        async scan(
            cursor: string,
            _match: "MATCH",
            pattern: string,
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            ..._rest: unknown[]
        ): Promise<[string, string[]]> {
            if (cursor !== "0") return ["0", []];
            const re = new RegExp("^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
            const matches = Array.from(store.keys()).filter((k) => re.test(k));
            return ["0", matches];
        },
    };
    return { fakeRedis: inst };
});

vi.mock("@/lib/redis", () => ({ redis: fakeRedis }));
vi.mock("./redis", () => ({ redis: fakeRedis }));

import { __testing__, cacheKey, del, delByPattern, delMany, getOrSet, jitter, mget } from "./cache";

beforeEach(() => {
    fakeRedis.store.clear();
    fakeRedis.failGet = false;
    fakeRedis.failSet = false;
    __testing__.inflight.clear();
});

afterEach(() => {
    vi.useRealTimers();
});

describe("cache — jitter", () => {
    it("returns ttl unchanged when ratio is 0", () => {
        expect(jitter(60, 0)).toBe(60);
    });

    it("clamps to 1 when ttl is too small", () => {
        expect(jitter(0.01, 0.1)).toBeGreaterThanOrEqual(1);
    });

    it("stays within ±ratio of the input ttl", () => {
        for (let i = 0; i < 50; i++) {
            const v = jitter(100, 0.1);
            expect(v).toBeGreaterThanOrEqual(90);
            expect(v).toBeLessThanOrEqual(110);
        }
    });
});

describe("cache — getOrSet", () => {
    it("invokes loader on cache miss and stores envelope", async () => {
        const loader = vi.fn(async () => ({ x: 1 }));
        const v = await getOrSet("test:miss", { ttlSeconds: 30 }, loader);
        expect(v).toEqual({ x: 1 });
        expect(loader).toHaveBeenCalledOnce();
        const stored = fakeRedis.store.get(__testing__.fullKey("test:miss"));
        expect(stored).toBeDefined();
        const parsed = JSON.parse(stored!.value);
        expect(parsed.payload).toEqual({ x: 1 });
        expect(parsed.expiresAt).toBeGreaterThan(Date.now());
    });

    it("returns cached payload without calling loader on fresh hit", async () => {
        await getOrSet("test:hit", { ttlSeconds: 30 }, async () => ({ n: 1 }));
        const loader = vi.fn(async () => ({ n: 2 }));
        const v = await getOrSet("test:hit", { ttlSeconds: 30 }, loader);
        expect(v).toEqual({ n: 1 });
        expect(loader).not.toHaveBeenCalled();
    });

    it("serves stale and refreshes in the background (SWR)", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-05-01T00:00:00Z"));

        let counter = 0;
        const loader = vi.fn(async () => ({ n: ++counter }));
        const first = await getOrSet("test:swr", { ttlSeconds: 5 }, loader);
        expect(first).toEqual({ n: 1 });

        // Advance past freshness window but stay within Redis TTL grace.
        vi.setSystemTime(new Date("2026-05-01T00:00:10Z"));

        const second = await getOrSet("test:swr", { ttlSeconds: 5 }, loader);
        // Stale-while-revalidate — caller sees the previous payload.
        expect(second).toEqual({ n: 1 });
        // Background refresh runs, so loader was scheduled a 2nd time.
        await vi.waitFor(() => expect(loader).toHaveBeenCalledTimes(2), { timeout: 1000 });

        // After the refresh resolves, the cache holds the fresh value.
        await vi.waitFor(async () => {
            const v = await getOrSet("test:swr", { ttlSeconds: 5 }, loader);
            expect(v).toEqual({ n: 2 });
        });
    });

    it("bypass forces a fresh load and overwrites cache", async () => {
        await getOrSet("test:bypass", { ttlSeconds: 60 }, async () => ({ v: 1 }));
        const v = await getOrSet("test:bypass", { ttlSeconds: 60, bypass: true }, async () => ({
            v: 2,
        }));
        expect(v).toEqual({ v: 2 });
        const cached = await getOrSet("test:bypass", { ttlSeconds: 60 }, async () => ({ v: 3 }));
        expect(cached).toEqual({ v: 2 });
    });

    it("dedupes concurrent loads for the same key", async () => {
        let resolveLoader: ((v: { n: number }) => void) | null = null;
        const loader = vi.fn(
            () =>
                new Promise<{ n: number }>((resolve) => {
                    resolveLoader = resolve;
                })
        );
        const a = getOrSet("test:dedup", { ttlSeconds: 30 }, loader);
        const b = getOrSet("test:dedup", { ttlSeconds: 30 }, loader);
        // Flush microtasks so both safeRead → refresh chains have run.
        await new Promise((r) => setImmediate(r));
        expect(loader).toHaveBeenCalledTimes(1);
        resolveLoader!({ n: 42 });
        await expect(a).resolves.toEqual({ n: 42 });
        await expect(b).resolves.toEqual({ n: 42 });
    });

    it("falls back to loader when redis read fails", async () => {
        fakeRedis.failGet = true;
        const v = await getOrSet("test:redis-down", { ttlSeconds: 30 }, async () => ({ ok: 1 }));
        expect(v).toEqual({ ok: 1 });
    });

    it("propagates loader errors on cache miss", async () => {
        await expect(
            getOrSet("test:err", { ttlSeconds: 30 }, async () => {
                throw new Error("boom");
            })
        ).rejects.toThrow("boom");
    });
});

describe("cache — invalidation", () => {
    it("del removes a single key", async () => {
        await getOrSet("test:del", { ttlSeconds: 30 }, async () => 1);
        await del("test:del");
        const loader = vi.fn(async () => 2);
        const v = await getOrSet("test:del", { ttlSeconds: 30 }, loader);
        expect(v).toBe(2);
        expect(loader).toHaveBeenCalledOnce();
    });

    it("delMany removes several keys at once", async () => {
        await getOrSet("test:m1", { ttlSeconds: 30 }, async () => 1);
        await getOrSet("test:m2", { ttlSeconds: 30 }, async () => 1);
        await delMany(["test:m1", "test:m2"]);
        expect(fakeRedis.store.size).toBe(0);
    });

    it("delByPattern wipes matching keys via SCAN", async () => {
        await getOrSet("test:settings:booking", { ttlSeconds: 30 }, async () => 1);
        await getOrSet("test:settings:other", { ttlSeconds: 30 }, async () => 1);
        await getOrSet("test:other:keep", { ttlSeconds: 30 }, async () => 1);
        const removed = await delByPattern("test:settings:*");
        expect(removed).toBe(2);
        expect(fakeRedis.store.has(__testing__.fullKey("test:other:keep"))).toBe(true);
    });
});

describe("cache — mget", () => {
    it("returns aligned payloads with nulls for missing keys", async () => {
        await getOrSet("test:a", { ttlSeconds: 30 }, async () => "A");
        await getOrSet("test:c", { ttlSeconds: 30 }, async () => "C");
        const out = await mget<string>(["test:a", "test:b", "test:c"]);
        expect(out).toEqual(["A", null, "C"]);
    });

    it("returns all-null array when redis fails", async () => {
        fakeRedis.failGet = true;
        const out = await mget<string>(["x", "y"]);
        expect(out).toEqual([null, null]);
    });
});

describe("cache — cacheKey helpers", () => {
    it("produces stable namespaces", () => {
        expect(cacheKey.bookingSettings()).toBe("settings:booking");
        expect(cacheKey.activeCategories()).toBe("categories:active");
        expect(cacheKey.productFacets()).toBe("products:facets:all");
        expect(cacheKey.productFacets("h:abc")).toBe("products:facets:h:abc");
    });
});
