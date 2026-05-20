/**
 * Per-recipient send unit tests for `lib/telegram-broadcasts/send.ts`.
 *
 * Drives `sendBroadcastToRecipient` through three core scenarios:
 *
 *   1. claim insert succeeds → grammY sendMessage called once →
 *      notification_log row marked sent + sentCount++ + completion CAS fires.
 *   2. claim insert raises Postgres `23505` (unique_violation) → returns
 *      `{ skipped: true, reason: "already_sent" }` and grammY is NOT called.
 *   3. claim insert succeeds but grammY throws → notification_log row
 *      marked failed + failedCount++ + completion CAS fires.
 *
 * The DB is mocked at the module boundary with a queue of `select` results
 * and recorders for `insert` / `update` calls so we can pin the exact set
 * of writes that fired in each scenario. This is the same hoisted-mocks
 * pattern used by the booking + downsize reminders tests.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 12.1, 12.2, 12.3, 12.4
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TelegramBroadcast } from "@/db";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { sendMessageMock, pgErrorCodeMock, dbState, dbModule } = vi.hoisted(() => {
    type Tag = "telegramBroadcasts" | "notificationLogs" | "unknown";

    interface InsertCall {
        table: Tag;
        values: Record<string, unknown>;
    }
    interface UpdateCall {
        table: Tag;
        set: Record<string, unknown>;
    }

    interface DbState {
        /** Queue of rows that the next `insert(...).returning()` resolves with. */
        insertReturnQueue: Array<unknown[] | Error>;
        insertCalls: InsertCall[];
        updateCalls: UpdateCall[];
    }

    const dbState: DbState = {
        insertReturnQueue: [],
        insertCalls: [],
        updateCalls: [],
    };

    const notificationLogs = {
        __table: "notificationLogs",
        id: { __col: "id" },
        metadata: { __col: "metadata" },
    } as const;
    const telegramBroadcasts = {
        __table: "telegramBroadcasts",
        id: { __col: "id" },
        sentCount: { __col: "sentCount" },
        failedCount: { __col: "failedCount" },
        recipientCount: { __col: "recipientCount" },
        state: { __col: "state" },
    } as const;

    function tableTag(table: object): Tag {
        return ((table as { __table?: string }).__table ?? "unknown") as Tag;
    }

    const dbModule = {
        db: {
            insert: (table: object) => ({
                values: (v: Record<string, unknown>) => {
                    dbState.insertCalls.push({ table: tableTag(table), values: v });
                    return {
                        returning: async () => {
                            const next = dbState.insertReturnQueue.shift();
                            if (next instanceof Error) throw next;
                            return next ?? [];
                        },
                    };
                },
            }),
            update: (table: object) => ({
                set: (s: Record<string, unknown>) => ({
                    where: async () => {
                        dbState.updateCalls.push({
                            table: tableTag(table),
                            set: s,
                        });
                    },
                }),
            }),
        },
        notificationLogs,
        telegramBroadcasts,
    };

    return {
        sendMessageMock: vi.fn(async () => ({ message_id: 4242 })),
        pgErrorCodeMock: vi.fn((err: unknown) => {
            const e = err as { code?: string } | null | undefined;
            return e?.code;
        }),
        dbState,
        dbModule,
    };
});

vi.mock("@/db", () => dbModule);

// Stubbed entirely (importActual would pull in next-auth, which transitively
// fails to resolve under jsdom). We only need `pgErrorCode` for the send
// module under test.
vi.mock("@/lib/api", () => ({
    pgErrorCode: pgErrorCodeMock,
}));

vi.mock("@/lib/telegram/bot", () => ({
    getBot: () => ({ api: { sendMessage: sendMessageMock } }),
}));

vi.mock("drizzle-orm", () => ({
    eq: (..._a: unknown[]) => null,
    and: (..._a: unknown[]) => null,
    sql: ((..._a: unknown[]) => null) as unknown as { (...a: unknown[]): null },
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { sendBroadcastToRecipient } from "./send";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function makeBroadcast(overrides: Partial<TelegramBroadcast> = {}): TelegramBroadcast {
    return {
        id: "broadcast-uuid",
        title: "Заголовок",
        bodyText: "Привет!",
        parseMode: "HTML",
        inlineButtonLabel: null,
        inlineButtonUrl: null,
        state: "sending",
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        recipientCount: 1,
        sentCount: 0,
        failedCount: 0,
        createdByUserId: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        ...overrides,
    } as TelegramBroadcast;
}

const NOW = new Date("2026-05-01T00:00:00Z");

beforeEach(() => {
    sendMessageMock.mockReset().mockResolvedValue({ message_id: 4242 });
    pgErrorCodeMock.mockReset().mockImplementation((err: unknown) => {
        const e = err as { code?: string } | null | undefined;
        return e?.code;
    });
    dbState.insertReturnQueue.length = 0;
    dbState.insertCalls.length = 0;
    dbState.updateCalls.length = 0;
});

afterEach(() => {
    vi.clearAllMocks();
});

// ===========================================================================
// Property 5 — INSERT-claim send semantics
// ===========================================================================
describe("sendBroadcastToRecipient — Property 5: send / skip / fail trichotomy", () => {
    // ---- 1. happy path -----------------------------------------------------
    it("claim succeeds → grammY called once → log + counter + completion CAS", async () => {
        const b = makeBroadcast({ recipientCount: 1 });
        // The first insert (notification_log claim) returns one row.
        dbState.insertReturnQueue.push([{ id: "log-uuid" }]);

        const result = await sendBroadcastToRecipient({
            broadcast: b,
            telegramId: 12345,
            customerId: "c-uuid",
            now: NOW,
        });

        expect(result).toEqual({ sent: true, messageId: 4242 });

        // -- INSERT side --
        expect(dbState.insertCalls).toHaveLength(1);
        expect(dbState.insertCalls[0].table).toBe("notificationLogs");
        const claim = dbState.insertCalls[0].values;
        expect(claim).toMatchObject({
            channel: "telegram",
            type: "telegram_broadcast",
            recipient: "12345",
            status: "pending",
            customerId: "c-uuid",
        });
        expect(claim.metadata).toMatchObject({
            broadcastId: "broadcast-uuid",
            telegramId: "12345",
            customerId: "c-uuid",
        });

        // -- grammY: exactly one sendMessage call --
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
        expect(sendMessageMock).toHaveBeenCalledWith(
            12345,
            "Привет!",
            expect.objectContaining({ parse_mode: "HTML" })
        );

        // -- UPDATE side: log → sent, broadcast.sentCount++, completion CAS --
        const updateTables = dbState.updateCalls.map((c) => c.table);
        expect(updateTables).toEqual([
            "notificationLogs", // status='sent', providerId=…, sentAt=…
            "telegramBroadcasts", // sentCount + 1
            "telegramBroadcasts", // completion CAS (state='sent')
        ]);

        const logUpdate = dbState.updateCalls[0].set;
        expect(logUpdate).toMatchObject({
            status: "sent",
            providerId: "4242",
            sentAt: NOW,
        });

        const counterUpdate = dbState.updateCalls[1].set;
        expect("sentCount" in counterUpdate).toBe(true);

        const completionUpdate = dbState.updateCalls[2].set;
        expect(completionUpdate).toMatchObject({
            state: "sent",
            completedAt: NOW,
        });
    });

    // ---- 2. duplicate claim ------------------------------------------------
    it("claim returns Postgres 23505 → skipped:already_sent, no grammY, no log/counter writes", async () => {
        const b = makeBroadcast({ recipientCount: 5 });
        const dup = Object.assign(new Error("duplicate key"), { code: "23505" });
        dbState.insertReturnQueue.push(dup);

        const result = await sendBroadcastToRecipient({
            broadcast: b,
            telegramId: 67890,
            customerId: null,
            now: NOW,
        });

        expect(result).toEqual({ skipped: true, reason: "already_sent" });

        // grammY MUST NOT be called.
        expect(sendMessageMock).not.toHaveBeenCalled();

        // The only DB call recorded is the failed insert attempt.
        expect(dbState.insertCalls).toHaveLength(1);
        expect(dbState.updateCalls).toHaveLength(0);
    });

    // ---- 3. send fails after claim -----------------------------------------
    it("claim succeeds but grammY throws → log → failed, failedCount++, completion CAS", async () => {
        const b = makeBroadcast({ recipientCount: 1 });
        dbState.insertReturnQueue.push([{ id: "log-uuid" }]);
        sendMessageMock.mockRejectedValueOnce(
            Object.assign(new Error("Forbidden: bot was blocked"), {
                code: 403,
            })
        );

        const result = await sendBroadcastToRecipient({
            broadcast: b,
            telegramId: 999,
            customerId: null,
            now: NOW,
        });

        expect("failed" in result).toBe(true);
        if ("failed" in result) {
            expect(result.error).toMatch(/Forbidden|blocked/);
        }

        // grammY was attempted exactly once.
        expect(sendMessageMock).toHaveBeenCalledTimes(1);

        const updateTables = dbState.updateCalls.map((c) => c.table);
        expect(updateTables).toEqual([
            "notificationLogs", // status='failed' + metadata.error
            "telegramBroadcasts", // failedCount + 1
            "telegramBroadcasts", // completion CAS
        ]);

        expect(dbState.updateCalls[0].set).toMatchObject({
            status: "failed",
        });
        const failedCountUpdate = dbState.updateCalls[1].set;
        expect("failedCount" in failedCountUpdate).toBe(true);
        expect(dbState.updateCalls[2].set).toMatchObject({
            state: "sent",
            completedAt: NOW,
        });
    });

    // ---- 4. completion CAS always fires (sent) -----------------------------
    it("completion CAS query is issued after every successful send (sentCount path)", async () => {
        const b = makeBroadcast({ recipientCount: 1, sentCount: 0, failedCount: 0 });
        dbState.insertReturnQueue.push([{ id: "log-uuid" }]);

        await sendBroadcastToRecipient({
            broadcast: b,
            telegramId: 111,
            customerId: null,
            now: NOW,
        });

        const completion = dbState.updateCalls[2].set;
        expect(completion).toMatchObject({
            state: "sent",
            completedAt: NOW,
        });
    });

    // ---- 5. completion CAS always fires (failed) ---------------------------
    it("completion CAS query is issued after every failed send (failedCount path)", async () => {
        const b = makeBroadcast({ recipientCount: 1 });
        dbState.insertReturnQueue.push([{ id: "log-uuid" }]);
        sendMessageMock.mockRejectedValueOnce(new Error("network error"));

        await sendBroadcastToRecipient({
            broadcast: b,
            telegramId: 333,
            customerId: null,
            now: NOW,
        });

        const completion = dbState.updateCalls[2].set;
        expect(completion).toMatchObject({
            state: "sent",
            completedAt: NOW,
        });
    });

    // ---- 6. payload renderer error before claim ----------------------------
    it("render-time error short-circuits with `failed:render_failed:…`, no insert, no grammY", async () => {
        const b = makeBroadcast({
            // bypass type system to simulate a corrupt row
            parseMode: "BOGUS" as unknown as TelegramBroadcast["parseMode"],
        });

        const result = await sendBroadcastToRecipient({
            broadcast: b,
            telegramId: 1,
            customerId: null,
            now: NOW,
        });

        expect("failed" in result).toBe(true);
        if ("failed" in result) {
            expect(result.error).toMatch(/^render_failed:/);
        }

        expect(dbState.insertCalls).toHaveLength(0);
        expect(sendMessageMock).not.toHaveBeenCalled();
        expect(dbState.updateCalls).toHaveLength(0);
    });

    // ---- 7. non-23505 errors propagate -------------------------------------
    it("non-23505 insert errors propagate (no skip, no failure-recording path)", async () => {
        const b = makeBroadcast();
        const dbErr = Object.assign(new Error("connection lost"), {
            code: "08006",
        });
        dbState.insertReturnQueue.push(dbErr);

        await expect(
            sendBroadcastToRecipient({
                broadcast: b,
                telegramId: 1,
                customerId: null,
                now: NOW,
            })
        ).rejects.toThrow(/connection lost/);

        expect(sendMessageMock).not.toHaveBeenCalled();
    });
});
