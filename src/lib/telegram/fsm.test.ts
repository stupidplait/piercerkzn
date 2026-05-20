/**
 * Unit tests for the bot FSM persistence layer.
 *
 * Validates the contract described in design §7 of the
 * telegram-interactive-flows spec — load / save / clear, the staleness TTL,
 * the `parseBotState` decoder, and the `withFsm` helper.
 *
 * Drizzle's `db` and the schema exports are mocked at the module boundary
 * so no real DB is required. The fake captures the latest `update().set()`
 * payload per `telegramId`, which is enough to exercise every property
 * listed in task 7.1.
 *
 * Properties covered:
 *   - Property 6: TTL discriminator (29:59 returns; 30:01 returns null + clears)
 *   - Property 7: FSM round-trip
 */
import { fc, fcAssert } from "@/test/property/fc-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// ---------------------------------------------------------------------------
// Hoisted DB mock — see app/src/lib/booking/reminders.test.ts for the pattern.
// ---------------------------------------------------------------------------
const { dbState, dbModule } = vi.hoisted(() => {
    interface DbState {
        // Map<telegramId, last persisted bot_state value>.
        rows: Map<number, unknown>;
        // Capture every update so tests can assert order (e.g. stale-clear
        // before returning null).
        updates: Array<{ telegramId: number; botState: unknown }>;
        // The next `select` call returns this value (single-row result).
        nextSelectRow: { botState: unknown } | null;
    }
    const dbState: DbState = {
        rows: new Map(),
        updates: [],
        nextSelectRow: null,
    };

    const telegramBotUsers = {
        __table: "telegramBotUsers",
        botState: { __col: "botState" },
        telegramId: { __col: "telegramId" },
    } as const;

    function makeSelectChain() {
        const result = () => (dbState.nextSelectRow ? [dbState.nextSelectRow] : []);
        const obj: {
            from: () => typeof obj;
            where: (cond: unknown) => typeof obj;
            limit: (n: number) => typeof obj;
            then: (
                resolve: (v: unknown) => unknown,
                reject?: (e: unknown) => unknown
            ) => Promise<unknown>;
            catch: (reject: (e: unknown) => unknown) => Promise<unknown>;
        } = {
            from: () => obj,
            where: () => obj,
            limit: () => obj,
            then(resolve, reject) {
                return Promise.resolve(result()).then(resolve, reject);
            },
            catch(reject) {
                return Promise.resolve(result()).catch(reject);
            },
        };
        return obj;
    }

    function makeUpdateChain() {
        let pendingState: unknown = undefined;
        const obj = {
            set(values: { botState?: unknown }) {
                pendingState = values.botState;
                return obj;
            },
            // The where clause carries the telegramId; we capture it via a
            // sentinel object created in `eq()` — see drizzle-orm mock below.
            where(cond: { telegramId: number } | null) {
                const tgId = cond?.telegramId ?? -1;
                dbState.updates.push({ telegramId: tgId, botState: pendingState });
                if (tgId !== -1) dbState.rows.set(tgId, pendingState);
                return Promise.resolve(undefined);
            },
        };
        return obj;
    }

    const dbModule = {
        db: {
            select: () => makeSelectChain(),
            update: () => makeUpdateChain(),
        },
        telegramBotUsers,
    };

    return { dbState, dbModule };
});

vi.mock("@/db", () => dbModule);

// drizzle-orm helpers — only `eq()` is used. We encode the (column, value)
// pair into the sentinel structure expected by the update-chain `where()`.
vi.mock("drizzle-orm", () => ({
    eq: (col: { __col?: string }, value: unknown) => {
        if (col?.__col === "telegramId" && typeof value === "number") {
            return { telegramId: value };
        }
        return null;
    },
}));

// ---------------------------------------------------------------------------
// Module under test (imported AFTER mocks)
// ---------------------------------------------------------------------------
import {
    type BotState,
    STALE_TTL_MS,
    clearBotState,
    isStale,
    loadBotState,
    parseBotState,
    saveBotState,
    withFsm,
} from "./fsm";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
beforeEach(() => {
    dbState.rows.clear();
    dbState.updates.length = 0;
    dbState.nextSelectRow = null;
});

afterEach(() => {
    vi.useRealTimers();
});

function isoAt(ms: number): string {
    return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// parseBotState — defensive decoder
// ---------------------------------------------------------------------------
describe("parseBotState — defensive decoder", () => {
    it("decodes a well-formed reserve state", () => {
        const input = {
            flow: "reserve",
            step: "browse_product",
            data: { categoryId: "cat-1", page: 0 },
            updatedAt: "2026-05-16T14:32:01.000Z",
        };
        expect(parseBotState(input)).toEqual(input);
    });

    it("decodes a well-formed book state", () => {
        const input = {
            flow: "book",
            step: "select_time",
            data: { serviceId: "svc-1", date: "2026-05-20" },
            updatedAt: "2026-05-16T14:32:01.000Z",
        };
        expect(parseBotState(input)).toEqual(input);
    });

    it("returns null for the legacy '{}' default", () => {
        expect(parseBotState({})).toBeNull();
    });

    it("returns null for null / non-object inputs", () => {
        expect(parseBotState(null)).toBeNull();
        expect(parseBotState("nope")).toBeNull();
        expect(parseBotState(42)).toBeNull();
        expect(parseBotState(undefined)).toBeNull();
    });

    it("returns null when flow is unknown", () => {
        expect(
            parseBotState({
                flow: "checkout",
                step: "browse_product",
                data: {},
                updatedAt: "2026-05-16T14:32:01.000Z",
            })
        ).toBeNull();
    });

    it("returns null when step is invalid for the flow", () => {
        expect(
            parseBotState({
                flow: "reserve",
                step: "select_time", // book step on reserve flow
                data: {},
                updatedAt: "2026-05-16T14:32:01.000Z",
            })
        ).toBeNull();
        expect(
            parseBotState({
                flow: "book",
                step: "browse_category", // reserve step on book flow
                data: {},
                updatedAt: "2026-05-16T14:32:01.000Z",
            })
        ).toBeNull();
    });

    it("returns null when updatedAt is missing or wrong type", () => {
        expect(parseBotState({ flow: "reserve", step: "browse_category", data: {} })).toBeNull();
        expect(
            parseBotState({
                flow: "reserve",
                step: "browse_category",
                data: {},
                updatedAt: 123,
            })
        ).toBeNull();
    });

    it("returns null when data is not an object", () => {
        expect(
            parseBotState({
                flow: "reserve",
                step: "browse_category",
                data: "x",
                updatedAt: "2026-05-16T14:32:01.000Z",
            })
        ).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// isStale — boundary helper
// ---------------------------------------------------------------------------
describe("isStale", () => {
    it("treats unparseable updatedAt as stale", () => {
        expect(isStale({ updatedAt: "not-a-date" }, 0)).toBe(true);
    });

    it("returns false at exactly TTL", () => {
        const now = 1_000_000_000_000;
        const ts = isoAt(now - STALE_TTL_MS);
        expect(isStale({ updatedAt: ts }, now)).toBe(false);
    });

    it("returns true one ms after TTL", () => {
        const now = 1_000_000_000_000;
        const ts = isoAt(now - STALE_TTL_MS - 1);
        expect(isStale({ updatedAt: ts }, now)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Property 6 — TTL discriminator
// Validates: Requirements 8.5, 9.2
// ---------------------------------------------------------------------------
describe("loadBotState — Property 6: TTL discriminator", () => {
    it("returns the state when 29:59 has elapsed", async () => {
        const now = Date.UTC(2026, 4, 16, 12, 0, 0);
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const fresh: BotState = {
            flow: "reserve",
            step: "browse_category",
            data: {},
            // 29:59 — within the 30-minute TTL.
            updatedAt: isoAt(now - (29 * 60 * 1000 + 59 * 1000)),
        };
        dbState.nextSelectRow = { botState: fresh };

        const result = await loadBotState(42);
        expect(result).toEqual(fresh);
        // No clear should have fired (no DB updates).
        expect(dbState.updates).toEqual([]);
    });

    it("returns null and triggers clearBotState when 30:01 has elapsed", async () => {
        const now = Date.UTC(2026, 4, 16, 12, 0, 0);
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const stale: BotState = {
            flow: "reserve",
            step: "browse_category",
            data: {},
            // 30:01 — strictly past the 30-minute TTL.
            updatedAt: isoAt(now - (30 * 60 * 1000 + 1_000)),
        };
        dbState.nextSelectRow = { botState: stale };

        const result = await loadBotState(42);
        expect(result).toBeNull();

        // The stale-clear path should have written `null` to the row.
        expect(dbState.updates).toHaveLength(1);
        expect(dbState.updates[0]).toEqual({ telegramId: 42, botState: null });
    });

    it("returns null when the row is missing", async () => {
        dbState.nextSelectRow = null;
        const result = await loadBotState(99);
        expect(result).toBeNull();
        expect(dbState.updates).toEqual([]);
    });

    it("returns null when the column is null", async () => {
        dbState.nextSelectRow = { botState: null };
        const result = await loadBotState(99);
        expect(result).toBeNull();
        expect(dbState.updates).toEqual([]);
    });

    it("returns null when the payload is malformed (legacy '{}')", async () => {
        dbState.nextSelectRow = { botState: {} };
        const result = await loadBotState(99);
        expect(result).toBeNull();
        expect(dbState.updates).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Property 7 — FSM round-trip
// Validates: Requirements 8.2, 8.3, 9.1
// ---------------------------------------------------------------------------
describe("FSM round-trip — Property 7: save then load returns the same payload", () => {
    // Generators carved to the BotState input space.
    const reserveStepArb = fc.constantFrom(
        "browse_category",
        "browse_product",
        "browse_variant",
        "confirm"
    ) as fc.Arbitrary<"browse_category" | "browse_product" | "browse_variant" | "confirm">;
    const bookStepArb = fc.constantFrom(
        "select_service",
        "select_date",
        "select_time",
        "collect_contact",
        "confirm"
    ) as fc.Arbitrary<
        "select_service" | "select_date" | "select_time" | "collect_contact" | "confirm"
    >;

    const idArb = fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !s.includes(":"));
    const isoDateArb = fc.constantFrom("2026-05-16", "2026-05-17", "2026-12-01", "2027-01-01");
    const hhmmArb = fc.constantFrom("10:00", "10:30", "13:45", "18:00");

    const reserveStateArb: fc.Arbitrary<BotState> = fc
        .tuple(
            reserveStepArb,
            fc.option(idArb, { nil: undefined }),
            fc.option(idArb, { nil: undefined }),
            fc.option(idArb, { nil: undefined }),
            fc.option(fc.nat(99), { nil: undefined })
        )
        .map(([step, categoryId, productId, variantId, page]) => ({
            flow: "reserve" as const,
            step,
            data: { categoryId, productId, variantId, page },
            // Serialised on save; the tested invariant ignores the value.
            updatedAt: "1970-01-01T00:00:00.000Z",
        }));

    const bookStateArb: fc.Arbitrary<BotState> = fc
        .tuple(
            bookStepArb,
            fc.option(idArb, { nil: undefined }),
            fc.option(fc.integer({ min: 15, max: 240 }), { nil: undefined }),
            fc.option(isoDateArb, { nil: undefined }),
            fc.option(hhmmArb, { nil: undefined }),
            fc.option(fc.nat(20), { nil: undefined }),
            fc.option(fc.array(isoDateArb, { maxLength: 5 }), { nil: undefined })
        )
        .map(([step, serviceId, durationMin, date, time, page, dates]) => ({
            flow: "book" as const,
            step,
            data: { serviceId, durationMin, date, time, page, dates },
            updatedAt: "1970-01-01T00:00:00.000Z",
        }));

    const stateArb = fc.oneof(reserveStateArb, bookStateArb);

    it("saveBotState then loadBotState returns the same payload (modulo updatedAt)", async () => {
        await fcAssert(
            fc.asyncProperty(
                fc.integer({ min: 1, max: 1_000_000 }),
                stateArb,
                async (tgId, state) => {
                    dbState.updates.length = 0;

                    const now = Date.UTC(2026, 4, 16, 12, 0, 0);
                    vi.useFakeTimers();
                    vi.setSystemTime(now);

                    await saveBotState(tgId, state);
                    // Saved payload becomes the next select result (the mock
                    // simulates a row read after the update).
                    const persisted = dbState.rows.get(tgId);
                    dbState.nextSelectRow = { botState: persisted };

                    const loaded = await loadBotState(tgId);

                    // Compare modulo updatedAt as documented in the property.
                    expect(loaded).not.toBeNull();
                    expect(loaded!.flow).toEqual(state.flow);
                    expect(loaded!.step).toEqual(state.step);
                    expect(loaded!.data).toEqual(state.data);
                    // updatedAt is restamped by saveBotState to the current ISO.
                    expect(loaded!.updatedAt).toEqual(isoAt(now));

                    vi.useRealTimers();
                }
            ),
            { numRuns: 50, seed: 1748001 }
        );
    });

    it("saveBotState always restamps updatedAt to now", async () => {
        const now = Date.UTC(2026, 4, 16, 12, 0, 0);
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const state: BotState = {
            flow: "reserve",
            step: "browse_category",
            data: {},
            // Stale on input — must be overwritten by save.
            updatedAt: "1970-01-01T00:00:00.000Z",
        };
        await saveBotState(7, state);

        const persisted = dbState.rows.get(7) as BotState;
        expect(persisted.updatedAt).toEqual(isoAt(now));
    });
});

// ---------------------------------------------------------------------------
// clearBotState — writes null
// Validates: Requirement 8.3
// ---------------------------------------------------------------------------
describe("clearBotState", () => {
    it("writes null to the row", async () => {
        await clearBotState(13);
        expect(dbState.updates).toEqual([{ telegramId: 13, botState: null }]);
        expect(dbState.rows.get(13)).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// withFsm — handler dispatch + persistence
// Validates: Requirement 8.2, 8.3
// ---------------------------------------------------------------------------
describe("withFsm", () => {
    it("calls handler with the loaded state and persists a non-null next state", async () => {
        const now = Date.UTC(2026, 4, 16, 12, 0, 0);
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const initial: BotState = {
            flow: "reserve",
            step: "browse_category",
            data: {},
            updatedAt: isoAt(now - 5_000),
        };
        const next: BotState = {
            flow: "reserve",
            step: "browse_product",
            data: { categoryId: "cat-1", page: 0 },
            updatedAt: "ignored",
        };
        dbState.nextSelectRow = { botState: initial };

        const handler = vi.fn(async (state: BotState | null) => {
            expect(state).toEqual(initial);
            return next;
        });

        await withFsm({ from: { id: 100 } }, handler);

        expect(handler).toHaveBeenCalledTimes(1);
        const persisted = dbState.rows.get(100) as BotState;
        expect(persisted.flow).toEqual("reserve");
        expect(persisted.step).toEqual("browse_product");
        expect(persisted.data).toEqual({ categoryId: "cat-1", page: 0 });
        expect(persisted.updatedAt).toEqual(isoAt(now));
    });

    it("clears the row when the handler returns null", async () => {
        const initial: BotState = {
            flow: "reserve",
            step: "browse_category",
            data: {},
            updatedAt: isoAt(Date.now() - 1_000),
        };
        dbState.nextSelectRow = { botState: initial };

        const handler = vi.fn(async () => null);

        await withFsm({ from: { id: 200 } }, handler);

        expect(handler).toHaveBeenCalledTimes(1);
        // The last update should be a clear (botState: null).
        const last = dbState.updates.at(-1);
        expect(last).toEqual({ telegramId: 200, botState: null });
    });

    it("is a no-op when ctx.from.id is missing", async () => {
        const handler = vi.fn();
        await withFsm({ from: undefined }, handler);
        expect(handler).not.toHaveBeenCalled();
        expect(dbState.updates).toEqual([]);
    });
});
