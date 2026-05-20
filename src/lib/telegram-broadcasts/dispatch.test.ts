/**
 * Telegram broadcast orchestration unit tests for `lib/telegram-broadcasts/dispatch.ts`.
 *
 * Mocks `enqueueTgBroadcastJob`, `selectBroadcastAudience`,
 * `getTelegramBroadcastSettings`, `sendBroadcastToRecipient`, and the DB at
 * the module boundary. The tests focus on the orchestration logic — chunk
 * counts, chunk pacing, empty-audience fast-path, and the cron sweeper's
 * promote pass.
 *
 * Properties covered:
 *   - Property 6:  fanout enqueues exactly `audienceLength` jobs across
 *                  `ceil(audienceLength / chunkSize)` chunks with delays
 *                  `chunkIndex * chunkDelayMs`.
 *   - Property 7:  empty audience → state goes directly `sending → sent`,
 *                  all counters zero, no enqueues, no sendMessage calls.
 *   - Property 8:  `sweepDueBroadcasts(now)` promotes scheduled rows whose
 *                  `scheduledAt <= now` and leaves future rows untouched.
 *
 * Validates: Requirements 2.7, 3.4, 6.2, 9.1, 9.2
 */
import { fc, fcAssert } from "@/test/property/fc-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
    enqueueTgBroadcastJobMock,
    selectBroadcastAudienceMock,
    getTelegramBroadcastSettingsMock,
    sendBroadcastToRecipientMock,
    dbState,
    dbModule,
} = vi.hoisted(() => {
    type Tag = "telegramBroadcasts" | "notificationLogs" | "unknown";

    interface UpdateCall {
        table: Tag;
        set: Record<string, unknown>;
    }

    /** Map of broadcast id → row. The dispatch.ts orchestration only ever
     *  reads single rows by id and updates them with CAS predicates we don't
     *  inspect here, so we keep state simple. */
    interface DbState {
        broadcastsById: Map<string, Record<string, unknown>>;
        scheduledQueue: Array<{ id: string }>;
        stuckQueue: Array<{ id: string; startedAt: Date }>;
        notificationLoggedTelegramIds: Map<string, string[]>;
        updateCalls: UpdateCall[];
    }

    const dbState: DbState = {
        broadcastsById: new Map(),
        scheduledQueue: [],
        stuckQueue: [],
        notificationLoggedTelegramIds: new Map(),
        updateCalls: [],
    };

    const telegramBroadcasts = {
        __table: "telegramBroadcasts",
        id: { __col: "id" },
        state: { __col: "state" },
        scheduledAt: { __col: "scheduledAt" },
        startedAt: { __col: "startedAt" },
        recipientCount: { __col: "recipientCount" },
        sentCount: { __col: "sentCount" },
        failedCount: { __col: "failedCount" },
        createdAt: { __col: "createdAt" },
    } as const;

    const notificationLogs = {
        __table: "notificationLogs",
        type: { __col: "type" },
        metadata: { __col: "metadata" },
    } as const;

    function tableTag(table: object): Tag {
        return ((table as { __table?: string }).__table ?? "unknown") as Tag;
    }

    /**
     * Make a thenable chainable that decides which result to resolve based
     * on which table is being queried and the test's queued state.
     */
    function makeSelectChain(table: Tag, projection?: unknown) {
        let scope: "rows" | "scheduled" | "stuck" | "logged" = "rows";
        if (table === "telegramBroadcasts" && projection && typeof projection === "object") {
            const keys = Object.keys(projection as Record<string, unknown>);
            // Pass A — `select({ id })`: just the broadcast id.
            if (keys.length === 1 && keys[0] === "id") {
                scope = "scheduled";
            } else if (
                // Pass B — `select({ id, startedAt })`: the stuck recovery scan.
                keys.length === 2 &&
                keys.includes("id") &&
                keys.includes("startedAt")
            ) {
                scope = "stuck";
            }
        }
        if (table === "notificationLogs") scope = "logged";

        const obj = {
            from: () => obj,
            where: () => obj,
            limit: () => obj,
            innerJoin: () => obj,
            orderBy: () => obj,
            offset: () => obj,
            then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                let out: unknown;
                if (scope === "scheduled") {
                    out = dbState.scheduledQueue;
                    dbState.scheduledQueue = [];
                } else if (scope === "stuck") {
                    out = dbState.stuckQueue;
                    dbState.stuckQueue = [];
                } else if (scope === "logged") {
                    // We need the broadcast id — but we don't have a clean
                    // way to recover it from the chain here. Tests use
                    // `notificationLoggedTelegramIds.get("*")` as a default
                    // bucket; the sweeper test sets it explicitly.
                    const ids = dbState.notificationLoggedTelegramIds.get("*") ?? [];
                    out = ids.map((tgId) => ({ telegramId: tgId }));
                } else {
                    out = Array.from(dbState.broadcastsById.values());
                }
                return Promise.resolve(out).then(resolve, reject);
            },
            catch(reject: (e: unknown) => unknown) {
                return Promise.resolve([]).catch(reject);
            },
        };
        return obj;
    }

    /**
     * Drizzle's update().set().where() — used both by `runBroadcast` (CAS to
     * sending), `fanoutBroadcast` (counters + completion), and the sweeper
     * (bump startedAt). We just record every set + return a row that
     * matches whichever broadcast id is currently fed via the update path
     * — the test inspects calls, not state.
     */
    function makeUpdateChain(table: Tag) {
        return {
            set: (s: Record<string, unknown>) => {
                const captured = { table, set: s };
                return {
                    where: () => ({
                        returning: async () => {
                            dbState.updateCalls.push(captured);
                            // Echo back any one of the seeded broadcasts so
                            // CAS calls succeed. The test inspects mock
                            // counts + .updateCalls, not the returned row.
                            const seed = Array.from(dbState.broadcastsById.values())[0];
                            if (table === "telegramBroadcasts" && seed) {
                                return [{ ...seed, ...s }];
                            }
                            return [];
                        },
                        // Drizzle's update without `.returning()` resolves
                        // directly on the where() call.
                        then(resolve: (v: unknown) => unknown, _reject?: (e: unknown) => unknown) {
                            dbState.updateCalls.push(captured);
                            return Promise.resolve(undefined).then(resolve);
                        },
                    }),
                };
            },
        };
    }

    const dbModule = {
        db: {
            select: (projection?: unknown) => ({
                from: (table: object) => makeSelectChain(tableTag(table), projection),
            }),
            update: (table: object) => makeUpdateChain(tableTag(table)),
            insert: (_table: object) => ({
                values: () => ({
                    returning: async () => [],
                }),
            }),
            delete: (_table: object) => ({
                where: () => ({
                    returning: async () => [],
                }),
            }),
        },
        telegramBroadcasts,
        notificationLogs,
    };

    return {
        enqueueTgBroadcastJobMock: vi.fn(
            async (
                _job: { broadcastId: string; telegramId: number; customerId: string | null },
                _delayMs?: number
            ) => undefined
        ),
        selectBroadcastAudienceMock: vi.fn(
            async () =>
                [] as Array<{
                    telegramId: number;
                    customerId: string | null;
                }>
        ),
        getTelegramBroadcastSettingsMock: vi.fn(async () => ({
            chunkSize: 30,
            chunkDelayMs: 1100,
            stuckAfterMs: 30 * 60 * 1000,
            parseMode: "HTML" as const,
        })),
        sendBroadcastToRecipientMock: vi.fn(async () => ({
            sent: true,
            messageId: 1,
        })),
        dbState,
        dbModule,
    };
});

vi.mock("@/db", () => dbModule);

vi.mock("@/lib/queue", () => ({
    enqueueTgBroadcastJob: enqueueTgBroadcastJobMock,
}));

vi.mock("@/lib/settings", () => ({
    getTelegramBroadcastSettings: getTelegramBroadcastSettingsMock,
}));

vi.mock("./audience", () => ({
    selectBroadcastAudience: selectBroadcastAudienceMock,
}));

vi.mock("./send", () => ({
    sendBroadcastToRecipient: sendBroadcastToRecipientMock,
}));

vi.mock("drizzle-orm", () => ({
    eq: (..._a: unknown[]) => null,
    and: (..._a: unknown[]) => null,
    asc: (..._a: unknown[]) => null,
    desc: (..._a: unknown[]) => null,
    inArray: (..._a: unknown[]) => null,
    lt: (..._a: unknown[]) => null,
    lte: (..._a: unknown[]) => null,
    sql: ((..._a: unknown[]) => null) as unknown as { (...a: unknown[]): null },
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { chunk, fanoutBroadcast, runBroadcast, sweepDueBroadcasts } from "./dispatch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const NOW = new Date("2026-05-01T12:00:00Z");

function seedBroadcast(id: string, overrides: Record<string, unknown> = {}) {
    dbState.broadcastsById.set(id, {
        id,
        state: "sending",
        scheduledAt: null,
        startedAt: NOW,
        recipientCount: 0,
        sentCount: 0,
        failedCount: 0,
        createdAt: NOW,
        ...overrides,
    });
}

beforeEach(() => {
    enqueueTgBroadcastJobMock.mockReset().mockResolvedValue(undefined);
    selectBroadcastAudienceMock.mockReset().mockResolvedValue([]);
    getTelegramBroadcastSettingsMock.mockReset().mockResolvedValue({
        chunkSize: 30,
        chunkDelayMs: 1100,
        stuckAfterMs: 30 * 60 * 1000,
        parseMode: "HTML",
    });
    sendBroadcastToRecipientMock.mockReset().mockResolvedValue({
        sent: true,
        messageId: 1,
    });
    dbState.broadcastsById.clear();
    dbState.scheduledQueue = [];
    dbState.stuckQueue = [];
    dbState.notificationLoggedTelegramIds.clear();
    dbState.updateCalls = [];
});

afterEach(() => {
    vi.clearAllMocks();
});

// ===========================================================================
// chunk() helper sanity
// ===========================================================================
describe("chunk() helper", () => {
    it("splits an array into contiguous groups of `size`", () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunk([1, 2, 3, 4], 2)).toEqual([
            [1, 2],
            [3, 4],
        ]);
        expect(chunk([], 2)).toEqual([]);
    });
    it("size <= 0 returns the original array as a single chunk", () => {
        expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
        expect(chunk([1], -5)).toEqual([[1]]);
    });
});

// ===========================================================================
// Property 6 — fanout enqueue counts and chunk pacing
// ===========================================================================
describe("fanoutBroadcast — Property 6: chunked enqueue with pacing", () => {
    it("enqueues exactly audienceLength jobs across ceil(audience/chunkSize) chunks", async () => {
        seedBroadcast("b1", { state: "sending", recipientCount: 0 });

        const audience = Array.from({ length: 65 }, (_, i) => ({
            telegramId: 1000 + i,
            customerId: i % 2 === 0 ? `c-${i}` : null,
        }));
        selectBroadcastAudienceMock.mockResolvedValueOnce(audience);
        getTelegramBroadcastSettingsMock.mockResolvedValueOnce({
            chunkSize: 30,
            chunkDelayMs: 1100,
            stuckAfterMs: 30 * 60 * 1000,
            parseMode: "HTML",
        });

        await fanoutBroadcast("b1", NOW);

        expect(enqueueTgBroadcastJobMock).toHaveBeenCalledTimes(65);

        // Distribution by delay: 0 → 30, 1100 → 30, 2200 → 5.
        const calls = enqueueTgBroadcastJobMock.mock.calls;
        const byDelay = new Map<number, number>();
        for (const [, delay] of calls) {
            byDelay.set(delay as number, (byDelay.get(delay as number) ?? 0) + 1);
        }
        expect(byDelay.get(0)).toBe(30);
        expect(byDelay.get(1100)).toBe(30);
        expect(byDelay.get(2200)).toBe(5);
    });

    it("fc — for any (audienceLength, chunkSize), enqueue count = audienceLength and unique delays = ceil(audience/chunkSize)", async () => {
        await fcAssert(
            fc.asyncProperty(
                fc.integer({ min: 0, max: 250 }),
                fc.integer({ min: 1, max: 64 }),
                fc.integer({ min: 100, max: 5000 }),
                async (audienceLength, chunkSize, chunkDelayMs) => {
                    enqueueTgBroadcastJobMock.mockClear();
                    dbState.broadcastsById.clear();
                    seedBroadcast("bX");

                    const audience = Array.from({ length: audienceLength }, (_, i) => ({
                        telegramId: 1 + i,
                        customerId: null,
                    }));
                    selectBroadcastAudienceMock.mockResolvedValueOnce(audience);
                    getTelegramBroadcastSettingsMock.mockResolvedValueOnce({
                        chunkSize,
                        chunkDelayMs,
                        stuckAfterMs: 30 * 60 * 1000,
                        parseMode: "HTML",
                    });

                    await fanoutBroadcast("bX", NOW);

                    if (audienceLength === 0) {
                        return enqueueTgBroadcastJobMock.mock.calls.length === 0;
                    }

                    if (enqueueTgBroadcastJobMock.mock.calls.length !== audienceLength) {
                        return false;
                    }

                    const expectedChunks = Math.ceil(audienceLength / chunkSize);
                    const uniqueDelays = new Set(
                        enqueueTgBroadcastJobMock.mock.calls.map((c) => c[1] as number)
                    );
                    if (uniqueDelays.size !== expectedChunks) return false;

                    // Delays must be 0 .. (chunks-1) * chunkDelayMs.
                    for (let i = 0; i < expectedChunks; i++) {
                        if (!uniqueDelays.has(i * chunkDelayMs)) return false;
                    }
                    return true;
                }
            ),
            { numRuns: 30, seed: 7_777 }
        );
    });
});

// ===========================================================================
// Property 7 — empty audience fast-path
// ===========================================================================
describe("fanoutBroadcast — Property 7: empty audience fast-path", () => {
    it("empty audience → CAS straight to 'sent', no enqueues, no send calls", async () => {
        seedBroadcast("b-empty", { state: "sending", recipientCount: 0 });
        selectBroadcastAudienceMock.mockResolvedValueOnce([]);

        await fanoutBroadcast("b-empty", NOW);

        expect(enqueueTgBroadcastJobMock).not.toHaveBeenCalled();
        expect(sendBroadcastToRecipientMock).not.toHaveBeenCalled();

        // The single update should target telegramBroadcasts and CAS to 'sent'.
        expect(dbState.updateCalls).toHaveLength(1);
        expect(dbState.updateCalls[0].table).toBe("telegramBroadcasts");
        expect(dbState.updateCalls[0].set).toMatchObject({
            state: "sent",
            completedAt: NOW,
            recipientCount: 0,
            sentCount: 0,
            failedCount: 0,
        });
    });

    it("runBroadcast → fanout with empty audience: state CAS into sending then 'sent', no enqueues", async () => {
        seedBroadcast("b-empty-2", { state: "scheduled" });
        selectBroadcastAudienceMock.mockResolvedValueOnce([]);

        await runBroadcast("b-empty-2", {
            now: NOW,
            allowedFromStates: ["scheduled"],
        });

        expect(enqueueTgBroadcastJobMock).not.toHaveBeenCalled();
        // First update is the CAS into 'sending'; second is the fast-path
        // CAS into 'sent'.
        expect(dbState.updateCalls.length).toBeGreaterThanOrEqual(2);
        expect(dbState.updateCalls[0].set).toMatchObject({
            state: "sending",
            startedAt: NOW,
        });
        expect(
            dbState.updateCalls.find(
                (c) => typeof c.set.state === "string" && c.set.state === "sent"
            )
        ).toBeDefined();
    });
});

// ===========================================================================
// Property 8 — sweepDueBroadcasts promotes due rows, leaves future ones
// ===========================================================================
describe("sweepDueBroadcasts — Property 8: promote due scheduled rows", () => {
    it("promotes only rows whose scheduledAt <= now, leaves future rows untouched", async () => {
        // The query under test emits `scheduledAt <= now` already, so the
        // mocked select returns *only* the due rows. We assert that every
        // returned row is promoted via runBroadcast (a CAS into sending).
        seedBroadcast("b-due-1", { state: "scheduled" });
        seedBroadcast("b-due-2", { state: "scheduled" });
        // Future row is NOT in the queue — that's the WHERE filter doing
        // its job; the test's job is to verify the orchestrator only
        // touches what the query returned.
        dbState.scheduledQueue = [{ id: "b-due-1" }, { id: "b-due-2" }];
        // No stuck rows.
        dbState.stuckQueue = [];
        selectBroadcastAudienceMock.mockResolvedValue([]);

        const result = await sweepDueBroadcasts(NOW);

        expect(result.promoted).toBe(2);
        // Each promotion is a CAS update from 'scheduled' to 'sending';
        // empty audience also triggers a fast-path 'sent' CAS, so we should
        // see at least 4 updates targeting telegramBroadcasts.
        const sendingUpdates = dbState.updateCalls.filter(
            (c) => typeof c.set.state === "string" && c.set.state === "sending"
        );
        expect(sendingUpdates).toHaveLength(2);
    });

    it("returns { promoted: 0, recovered: 0 } when neither queue has matches", async () => {
        // No due rows, no stuck rows.
        dbState.scheduledQueue = [];
        dbState.stuckQueue = [];

        const result = await sweepDueBroadcasts(NOW);

        expect(result.promoted).toBe(0);
        expect(result.recovered).toBe(0);
        expect(result.recoveredJobs).toBe(0);
        expect(enqueueTgBroadcastJobMock).not.toHaveBeenCalled();
    });

    it("recovery pass: only re-enqueues recipients NOT already in notification_log", async () => {
        seedBroadcast("b-stuck", { state: "sending" });
        dbState.scheduledQueue = [];
        dbState.stuckQueue = [
            {
                id: "b-stuck",
                startedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
            },
        ];

        // Audience: 4 recipients.
        const audience = [
            { telegramId: 1, customerId: null },
            { telegramId: 2, customerId: "c-2" },
            { telegramId: 3, customerId: null },
            { telegramId: 4, customerId: "c-4" },
        ];
        selectBroadcastAudienceMock.mockResolvedValue(audience);
        // Two of them already logged → only 1 + 4 should re-enqueue.
        dbState.notificationLoggedTelegramIds.set("*", ["2", "3"]);

        const result = await sweepDueBroadcasts(NOW);

        expect(result.recovered).toBe(1);
        expect(result.recoveredJobs).toBe(2);
        const enqueuedTgIds = enqueueTgBroadcastJobMock.mock.calls.map(
            (c) => (c[0] as { telegramId: number }).telegramId
        );
        expect(new Set(enqueuedTgIds)).toEqual(new Set([1, 4]));

        // startedAt should be bumped to `now` for the recovered broadcast.
        const startedAtBump = dbState.updateCalls.find(
            (c) =>
                c.table === "telegramBroadcasts" && c.set.startedAt === NOW && !("state" in c.set)
        );
        expect(startedAtBump).toBeDefined();
    });
});
