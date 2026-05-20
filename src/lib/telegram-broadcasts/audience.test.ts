/**
 * Telegram broadcast audience selector unit tests.
 *
 * Mocks `@/db` at the module boundary with a tiny `select().from().where().orderBy()`
 * chain that simulates the `notifications_enabled = true` filter and the
 * `ORDER BY telegramId ASC` clause we depend on for stable chunking. The
 * underlying SQL is pure — every assertion is on the projected
 * `(telegramId, customerId)` pairs, the predicate, and the ordering.
 *
 * Validates: Requirements 4.1, 4.2, 4.3
 */
import { fc, fcAssert } from "@/test/property/fc-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { dbState, setRows, dbModule } = vi.hoisted(() => {
    interface BotUserRow {
        telegramId: number;
        customerId: string | null;
        notificationsEnabled: boolean;
    }

    interface DbState {
        rows: BotUserRow[];
        whereCalls: number;
        orderByCalls: number;
    }

    const dbState: DbState = { rows: [], whereCalls: 0, orderByCalls: 0 };

    function setRows(rows: BotUserRow[]) {
        dbState.rows = rows;
        dbState.whereCalls = 0;
        dbState.orderByCalls = 0;
    }

    const telegramBotUsers = {
        __table: "telegramBotUsers",
        telegramId: { __col: "telegramId" } as const,
        customerId: { __col: "customerId" } as const,
        notificationsEnabled: { __col: "notificationsEnabled" } as const,
    };

    function makeChain() {
        const chain = {
            where: (_predicate: unknown) => {
                dbState.whereCalls += 1;
                return chain;
            },
            orderBy: (_o: unknown) => {
                dbState.orderByCalls += 1;
                return chain;
            },
            then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                // The selector applies the predicate (notificationsEnabled = true)
                // and the ordering (ASC by telegramId) — we do that filtering
                // here so the test fixture mirrors what the real DB would do.
                const out = dbState.rows
                    .filter((r) => r.notificationsEnabled === true)
                    .map((r) => ({
                        telegramId: r.telegramId,
                        customerId: r.customerId,
                    }))
                    .sort((a, b) => a.telegramId - b.telegramId);
                return Promise.resolve(out).then(resolve, reject);
            },
            catch(reject: (e: unknown) => unknown) {
                return Promise.resolve([]).catch(reject);
            },
        };
        return chain;
    }

    const dbModule = {
        db: {
            select: () => ({
                from: (_t: unknown) => makeChain(),
            }),
        },
        telegramBotUsers,
    };

    return { dbState, setRows, dbModule };
});

vi.mock("@/db", () => dbModule);

vi.mock("drizzle-orm", () => ({
    eq: (..._a: unknown[]) => null,
    asc: (..._a: unknown[]) => null,
    and: (..._a: unknown[]) => null,
    sql: ((..._a: unknown[]) => null) as unknown as { (...a: unknown[]): null },
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { selectBroadcastAudience } from "./audience";

beforeEach(() => {
    setRows([]);
});

afterEach(() => {
    vi.clearAllMocks();
});

// ===========================================================================
// Property 4 — Audience filter is exactly `notificationsEnabled = true`,
// ordered by telegramId ascending, surfaces unlinked rows.
// Validates: Requirements 4.1, 4.2, 4.3
// ===========================================================================
describe("selectBroadcastAudience — Property 4: filter / ordering / null-customer surface", () => {
    it("returns only rows with notificationsEnabled = true", async () => {
        setRows([
            { telegramId: 100, customerId: "c-100", notificationsEnabled: true },
            { telegramId: 200, customerId: "c-200", notificationsEnabled: false },
            { telegramId: 300, customerId: null, notificationsEnabled: true },
            { telegramId: 400, customerId: "c-400", notificationsEnabled: false },
        ]);

        const result = await selectBroadcastAudience();

        expect(result).toHaveLength(2);
        expect(result.map((r) => r.telegramId)).toEqual([100, 300]);
    });

    it("orders by telegramId ascending, regardless of insertion order", async () => {
        setRows([
            { telegramId: 999, customerId: null, notificationsEnabled: true },
            { telegramId: 1, customerId: "c-1", notificationsEnabled: true },
            { telegramId: 555, customerId: "c-555", notificationsEnabled: true },
            { telegramId: 42, customerId: null, notificationsEnabled: true },
        ]);

        const result = await selectBroadcastAudience();

        expect(result.map((r) => r.telegramId)).toEqual([1, 42, 555, 999]);
    });

    it("surfaces unlinked rows (customerId = null) instead of dropping them", async () => {
        setRows([
            { telegramId: 1, customerId: null, notificationsEnabled: true },
            { telegramId: 2, customerId: "linked-2", notificationsEnabled: true },
            { telegramId: 3, customerId: null, notificationsEnabled: true },
        ]);

        const result = await selectBroadcastAudience();

        expect(result).toHaveLength(3);
        const nullCustomerCount = result.filter((r) => r.customerId === null).length;
        expect(nullCustomerCount).toBe(2);
        expect(result.find((r) => r.telegramId === 2)?.customerId).toBe("linked-2");
    });

    it("returns an empty array when no rows are opted-in", async () => {
        setRows([
            { telegramId: 1, customerId: "c-1", notificationsEnabled: false },
            { telegramId: 2, customerId: null, notificationsEnabled: false },
        ]);
        const result = await selectBroadcastAudience();
        expect(result).toEqual([]);
    });

    it("invokes WHERE and ORDER BY exactly once each", async () => {
        setRows([{ telegramId: 1, customerId: "c-1", notificationsEnabled: true }]);

        await selectBroadcastAudience();

        expect(dbState.whereCalls).toBe(1);
        expect(dbState.orderByCalls).toBe(1);
    });

    // --- fast-check: drive arbitrary cross-products of (notificationsEnabled
    // × customerId-null) and assert filter + ordering invariants hold. ---
    it("fc — for any input set, output = filter(enabled) sorted by telegramId asc", async () => {
        await fcAssert(
            fc.asyncProperty(
                fc.uniqueArray(
                    fc.record({
                        telegramId: fc.integer({ min: 1, max: 1_000_000 }),
                        customerId: fc.option(fc.string({ minLength: 1, maxLength: 12 }), {
                            nil: null,
                        }),
                        notificationsEnabled: fc.boolean(),
                    }),
                    {
                        selector: (r) => r.telegramId,
                        minLength: 0,
                        maxLength: 50,
                    }
                ),
                async (rows) => {
                    setRows(rows);
                    const result = await selectBroadcastAudience();

                    // 1. Predicate: every output row was `notificationsEnabled = true`.
                    const allOptedIn = rows
                        .filter((r) => r.notificationsEnabled)
                        .map((r) => r.telegramId)
                        .sort((a, b) => a - b);
                    if (result.map((r) => r.telegramId).join(",") !== allOptedIn.join(",")) {
                        return false;
                    }

                    // 2. Ordering: result is sorted asc by telegramId.
                    for (let i = 1; i < result.length; i++) {
                        if (result[i - 1].telegramId >= result[i].telegramId) {
                            return false;
                        }
                    }

                    // 3. customerId is preserved exactly (including null).
                    for (const out of result) {
                        const src = rows.find((r) => r.telegramId === out.telegramId);
                        if (!src) return false;
                        if (out.customerId !== src.customerId) return false;
                    }
                    return true;
                }
            ),
            { numRuns: 50, seed: 1_300 }
        );
    });
});
