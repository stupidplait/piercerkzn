/**
 * Unit tests for grammY bot command handlers.
 *
 * Strategy: mock the `grammy` module so that `new Bot(token)` returns a
 * lightweight stub that captures `b.command(name, handler)` registrations.
 * The tests then invoke the captured handlers directly with a synthesized
 * `ctx` object that carries `from.id`, the chat id, and a `reply` spy.
 *
 * The DB layer is mocked at the module boundary with table-tag
 * dispatch so we can pin the precise SQL path (`telegramBotUsers SELECT
 * → UPDATE` for the toggle commands).
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 11.2
 *  → Property 11: notify_off / notify_on idempotency, copy, /help text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
    grammyState,
    dbState,
    queueRows,
    dbModule,
    cancelReservationMock,
    quickReserveMock,
    reserveModuleMock,
    bookModuleMock,
    clearBotStateMock,
    loadBotStateMock,
} = vi.hoisted(() => {
    interface CapturedHandler {
        name: string;
        handler: (ctx: unknown) => Promise<void> | void;
    }

    const grammyState: {
        commands: CapturedHandler[];
        callbackQueryHandler: ((ctx: unknown) => Promise<void> | void) | null;
        messageHandlers: Array<{
            event: string;
            handler: (ctx: unknown) => Promise<void> | void;
        }>;
    } = {
        commands: [],
        callbackQueryHandler: null,
        messageHandlers: [],
    };

    interface BotUserRow {
        id: string;
        telegramId: number;
        notificationsEnabled: boolean;
        customerId: string | null;
    }
    interface DbState {
        botUsers: BotUserRow[];
        updates: Array<{ table: string; set: Record<string, unknown> }>;
        inserts: Array<{ table: string; values: Record<string, unknown> }>;
        // Selection routing — table → next return rows.
        nextSelect: Map<string, unknown[][]>;
    }
    const dbState: DbState = {
        botUsers: [],
        updates: [],
        inserts: [],
        nextSelect: new Map(),
    };

    function queueRows(table: string, rows: unknown[]) {
        const q = dbState.nextSelect.get(table) ?? [];
        q.push(rows);
        dbState.nextSelect.set(table, q);
    }

    const telegramBotUsers = {
        __table: "telegramBotUsers",
        id: { __col: "id" },
        telegramId: { __col: "telegramId" },
        notificationsEnabled: { __col: "notificationsEnabled" },
    } as const;
    const customers = { __table: "customers" } as const;
    const reservations = { __table: "reservations" } as const;
    const appointments = { __table: "appointments" } as const;

    function tableTag(t: object): string {
        return (t as { __table?: string }).__table ?? "unknown";
    }

    function makeChain(table: string) {
        const obj = {
            from: () => obj,
            where: () => obj,
            limit: () => obj,
            innerJoin: () => obj,
            orderBy: () => obj,
            offset: () => obj,
            then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                const queue = dbState.nextSelect.get(table);
                let rows: unknown[] = [];
                if (queue && queue.length > 0) {
                    rows = queue.shift() ?? [];
                }
                return Promise.resolve(rows).then(resolve, reject);
            },
            catch(reject: (e: unknown) => unknown) {
                return Promise.resolve([]).catch(reject);
            },
        };
        return obj;
    }

    const dbModule = {
        db: {
            select: () => ({
                from: (t: object) => makeChain(tableTag(t)),
            }),
            insert: (t: object) => ({
                values: async (v: Record<string, unknown>) => {
                    dbState.inserts.push({ table: tableTag(t), values: v });
                },
            }),
            update: (t: object) => ({
                set: (s: Record<string, unknown>) => ({
                    where: async () => {
                        dbState.updates.push({ table: tableTag(t), set: s });
                    },
                }),
            }),
        },
        telegramBotUsers,
        customers,
        reservations,
        appointments,
    };

    return {
        grammyState,
        dbState,
        queueRows,
        dbModule,
        cancelReservationMock: vi.fn(async () => null),
        quickReserveMock: vi.fn(async () => ({ ok: false, message: "" })),
        reserveModuleMock: {
            enter: vi.fn(async () => undefined),
            enterFromDeepLink: vi.fn(async () => undefined),
            handleCallback: vi.fn(async () => undefined),
        },
        bookModuleMock: {
            enter: vi.fn(async () => undefined),
            handleCallback: vi.fn(async () => undefined),
            handleContactMessage: vi.fn(async () => undefined),
            handleTextMessage: vi.fn(async () => undefined),
        },
        clearBotStateMock: vi.fn(async () => undefined),
        loadBotStateMock: vi.fn(async () => null),
    };
});

// ---------------------------------------------------------------------------
// grammy mock — capture command/callback handler registrations.
// ---------------------------------------------------------------------------
vi.mock("grammy", () => {
    class FakeBot {
        // grammY exposes `api` with method-shaped callers; we don't drive
        // outbound calls in these tests, so a no-op object is enough.
        api = {
            sendMessage: vi.fn(async () => ({ message_id: 1 })),
        };
        constructor(_token: string) {
            // no-op
        }
        command(name: string, handler: (ctx: unknown) => Promise<void> | void) {
            grammyState.commands.push({ name, handler });
        }
        on(event: string, handler: (ctx: unknown) => Promise<void> | void) {
            if (event === "callback_query:data") {
                grammyState.callbackQueryHandler = handler;
            } else {
                grammyState.messageHandlers.push({ event, handler });
            }
        }
        async init() {}
        isInited() {
            return true;
        }
    }
    class FakeInlineKeyboard {
        rows: unknown[] = [];
        text(_label: string, _data: string) {
            return this;
        }
        url(_label: string, _url: string) {
            return this;
        }
        webApp(_label: string, _url: string) {
            return this;
        }
        row() {
            return this;
        }
    }
    return { Bot: FakeBot, InlineKeyboard: FakeInlineKeyboard };
});

vi.mock("@/db", () => dbModule);

vi.mock("@/lib/reservations", () => ({
    cancelReservation: cancelReservationMock,
}));

vi.mock("./quick-reserve", () => ({
    quickReserveForCustomer: quickReserveMock,
}));

vi.mock("./flows/reserve", () => reserveModuleMock);
vi.mock("./flows/book", () => bookModuleMock);
vi.mock("./fsm", () => ({
    clearBotState: clearBotStateMock,
    loadBotState: loadBotStateMock,
}));

vi.mock("./mini-app", () => ({
    MINI_APP_VISUALIZER_PATH: "/visualizer",
}));

vi.mock("drizzle-orm", () => ({
    eq: (..._a: unknown[]) => null,
    and: (..._a: unknown[]) => null,
    or: (..._a: unknown[]) => null,
    desc: (..._a: unknown[]) => null,
    gte: (..._a: unknown[]) => null,
    inArray: (..._a: unknown[]) => null,
    sql: ((..._a: unknown[]) => null) as unknown as { (...a: unknown[]): null },
}));

// ---------------------------------------------------------------------------
// Module under test — must be loaded *after* the mocks above.
// ---------------------------------------------------------------------------
beforeEach(async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test:token";
    grammyState.commands.length = 0;
    grammyState.callbackQueryHandler = null;
    grammyState.messageHandlers.length = 0;
    dbState.botUsers.length = 0;
    dbState.updates.length = 0;
    dbState.inserts.length = 0;
    dbState.nextSelect.clear();
    cancelReservationMock.mockReset();
    quickReserveMock.mockReset();
    clearBotStateMock.mockReset().mockResolvedValue(undefined);
    loadBotStateMock.mockReset().mockResolvedValue(null);

    // Reset the module-level singleton so each test gets fresh handler
    // registrations. The bot uses `globalThis.__tgBot` for HMR-safety; we
    // wipe it before every reload.
    (globalThis as { __tgBot?: unknown }).__tgBot = undefined;
    vi.resetModules();
    const mod = await import("./bot");
    mod.getBot();
});

afterEach(() => {
    vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getCommandHandler(name: string) {
    const captured = grammyState.commands.find((c) => c.name === name);
    if (!captured) throw new Error(`command ${name} not registered`);
    return captured.handler;
}

interface FakeCtx {
    from: { id: number };
    reply: ReturnType<typeof vi.fn>;
    match: string;
    message?: { text?: string; contact?: unknown };
    callbackQuery?: { data: string };
    answerCallbackQuery?: ReturnType<typeof vi.fn>;
}

function makeCtx(tgId: number, overrides: Partial<FakeCtx> = {}): FakeCtx {
    return {
        from: { id: tgId },
        reply: vi.fn(async () => undefined),
        match: "",
        ...overrides,
    };
}

// ===========================================================================
// Property 11 — /notify_off / /notify_on idempotent toggles + Russian copy
// Validates: Requirements 8.1, 8.2, 8.3, 11.2
// ===========================================================================
describe("/notify_off — Property 11", () => {
    it("flips notificationsEnabled to false and replies with Russian confirmation", async () => {
        const handler = getCommandHandler("notify_off");
        const ctx = makeCtx(42);
        queueRows("telegramBotUsers", [
            { id: "user-1", telegramId: 42, notificationsEnabled: true },
        ]);

        await handler(ctx);

        // -- DB: SELECT -> single UPDATE on telegramBotUsers --
        expect(dbState.updates).toHaveLength(1);
        expect(dbState.updates[0].table).toBe("telegramBotUsers");
        expect(dbState.updates[0].set).toMatchObject({
            notificationsEnabled: false,
        });
        expect(dbState.updates[0].set.lastInteractionAt).toBeInstanceOf(Date);

        // -- Russian copy is exact-string --
        expect(ctx.reply).toHaveBeenCalledTimes(1);
        expect(ctx.reply).toHaveBeenCalledWith(
            "Уведомления отключены. Включить обратно — /notify_on"
        );
    });

    it("idempotent: a second invocation against an already-disabled row issues the same UPDATE and reply", async () => {
        const handler = getCommandHandler("notify_off");

        // First call — row is opted-in.
        queueRows("telegramBotUsers", [
            { id: "user-1", telegramId: 42, notificationsEnabled: true },
        ]);
        const ctx1 = makeCtx(42);
        await handler(ctx1);

        // Second call — row is now disabled (mock just keeps returning).
        queueRows("telegramBotUsers", [
            { id: "user-1", telegramId: 42, notificationsEnabled: false },
        ]);
        const ctx2 = makeCtx(42);
        await handler(ctx2);

        expect(dbState.updates).toHaveLength(2);
        expect(dbState.updates[1].set).toMatchObject({
            notificationsEnabled: false,
        });

        expect(ctx1.reply).toHaveBeenCalledWith(
            "Уведомления отключены. Включить обратно — /notify_on"
        );
        expect(ctx2.reply).toHaveBeenCalledWith(
            "Уведомления отключены. Включить обратно — /notify_on"
        );
    });

    it("short-circuits with /start guidance when no telegramBotUsers row exists", async () => {
        const handler = getCommandHandler("notify_off");
        queueRows("telegramBotUsers", []);
        const ctx = makeCtx(99);

        await handler(ctx);

        expect(dbState.updates).toHaveLength(0);
        expect(ctx.reply).toHaveBeenCalledTimes(1);
        expect(ctx.reply).toHaveBeenCalledWith(
            "Чтобы управлять уведомлениями, сначала отправьте /start."
        );
    });

    it("ignores updates with no `from.id`", async () => {
        const handler = getCommandHandler("notify_off");
        const ctx = makeCtx(0, { from: { id: undefined as unknown as number } });
        await handler(ctx);
        expect(dbState.updates).toHaveLength(0);
        expect(ctx.reply).not.toHaveBeenCalled();
    });
});

describe("/notify_on — Property 11", () => {
    it("flips notificationsEnabled to true and replies with Russian confirmation", async () => {
        const handler = getCommandHandler("notify_on");
        queueRows("telegramBotUsers", [
            { id: "user-1", telegramId: 42, notificationsEnabled: false },
        ]);
        const ctx = makeCtx(42);

        await handler(ctx);

        expect(dbState.updates).toHaveLength(1);
        expect(dbState.updates[0].table).toBe("telegramBotUsers");
        expect(dbState.updates[0].set).toMatchObject({
            notificationsEnabled: true,
        });
        expect(ctx.reply).toHaveBeenCalledWith("Уведомления включены. Отключить — /notify_off");
    });

    it("idempotent: a second invocation against an already-enabled row issues the same UPDATE and reply", async () => {
        const handler = getCommandHandler("notify_on");

        queueRows("telegramBotUsers", [
            { id: "user-1", telegramId: 42, notificationsEnabled: false },
        ]);
        const ctx1 = makeCtx(42);
        await handler(ctx1);

        queueRows("telegramBotUsers", [
            { id: "user-1", telegramId: 42, notificationsEnabled: true },
        ]);
        const ctx2 = makeCtx(42);
        await handler(ctx2);

        expect(dbState.updates).toHaveLength(2);
        expect(dbState.updates[1].set).toMatchObject({
            notificationsEnabled: true,
        });
        expect(ctx2.reply).toHaveBeenCalledWith("Уведомления включены. Отключить — /notify_off");
    });

    it("short-circuits with /start guidance when no telegramBotUsers row exists", async () => {
        const handler = getCommandHandler("notify_on");
        queueRows("telegramBotUsers", []);
        const ctx = makeCtx(101);

        await handler(ctx);

        expect(dbState.updates).toHaveLength(0);
        expect(ctx.reply).toHaveBeenCalledWith(
            "Чтобы управлять уведомлениями, сначала отправьте /start."
        );
    });
});

// ===========================================================================
// /help reply contains both new command lines
// ===========================================================================
describe("/help — copy includes /notify_off and /notify_on lines", () => {
    it("reply text contains the two new lines verbatim", async () => {
        const handler = getCommandHandler("help");
        const ctx = makeCtx(1);
        await handler(ctx);

        expect(ctx.reply).toHaveBeenCalledTimes(1);
        const replyText = ctx.reply.mock.calls[0][0] as string;

        expect(replyText).toContain("/notify_off — отключить рассылки");
        expect(replyText).toContain("/notify_on — включить рассылки");

        // Spot check: the new lines sit between /my_appointments and /reserve
        // /cancel (they're inserted after /my_appointments per the design).
        const lines = replyText.split("\n");
        const idxAppts = lines.findIndex((l) => l.startsWith("/my_appointments"));
        const idxOff = lines.findIndex((l) => l.startsWith("/notify_off"));
        const idxOn = lines.findIndex((l) => l.startsWith("/notify_on"));
        expect(idxAppts).toBeGreaterThanOrEqual(0);
        expect(idxOff).toBeGreaterThan(idxAppts);
        expect(idxOn).toBe(idxOff + 1);
    });
});
