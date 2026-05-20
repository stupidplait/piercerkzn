/**
 * Unit tests for the bot /visualizer command.
 *
 * Validates Properties: 10, 11
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const replyMock = vi.fn(async () => undefined);

// Capture InlineKeyboard calls
let lastWebAppArgs: { text: string; url: string } | null = null;

vi.mock("grammy", () => {
    class FakeBot {
        api = { sendMessage: vi.fn() };
        handlers: Array<{ name: string; handler: (ctx: unknown) => Promise<void> }> = [];
        command(name: string, handler: (ctx: unknown) => Promise<void>) {
            this.handlers.push({ name, handler });
        }
        on() {}
        async init() {}
        isInited() {
            return true;
        }
    }
    class FakeInlineKeyboard {
        _data: unknown[][] = [[]];
        webApp(text: string, url: string) {
            lastWebAppArgs = { text, url };
            this._data[this._data.length - 1].push({ text, web_app: { url } });
            return this;
        }
        text() {
            return this;
        }
        url() {
            return this;
        }
        row() {
            this._data.push([]);
            return this;
        }
    }
    return { Bot: FakeBot, InlineKeyboard: FakeInlineKeyboard };
});

vi.mock("@/db", () => ({
    db: {
        select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
    },
    telegramBotUsers: {},
    customers: {},
    reservations: {},
    appointments: {},
}));
vi.mock("@/lib/reservations", () => ({ cancelReservation: vi.fn() }));
vi.mock("./quick-reserve", () => ({ quickReserveForCustomer: vi.fn() }));
vi.mock("./flows/reserve", () => ({
    enter: vi.fn(),
    enterFromDeepLink: vi.fn(),
    handleCallback: vi.fn(),
}));
vi.mock("./flows/book", () => ({
    enter: vi.fn(),
    handleCallback: vi.fn(),
    handleContactMessage: vi.fn(),
    handleTextMessage: vi.fn(),
}));
vi.mock("./fsm", () => ({ clearBotState: vi.fn(), loadBotState: vi.fn() }));
vi.mock("drizzle-orm", () => ({
    eq: () => null,
    and: () => null,
    or: () => null,
    desc: () => null,
    gte: () => null,
    inArray: () => null,
    sql: () => null,
}));

let botModule: typeof import("./bot");

beforeEach(async () => {
    process.env.TELEGRAM_BOT_TOKEN = "test:token";
    process.env.NEXT_PUBLIC_SITE_URL = "https://example.test";
    (globalThis as { __tgBot?: unknown }).__tgBot = undefined;
    vi.resetModules();
    lastWebAppArgs = null;
    replyMock.mockClear();
    botModule = await import("./bot");
    botModule.getBot();
});

afterEach(() => {
    vi.clearAllMocks();
});

function getHandler(name: string) {
    const bot = (
        globalThis as {
            __tgBot?: {
                handlers: Array<{ name: string; handler: (ctx: unknown) => Promise<void> }>;
            };
        }
    ).__tgBot;
    const h = bot?.handlers?.find((c) => c.name === name);
    if (!h) throw new Error(`command ${name} not registered`);
    return h.handler;
}

describe("/visualizer bot command (Property 10)", () => {
    it("replies with a web_app button pointing at the visualizer URL", async () => {
        const handler = getHandler("visualizer");
        const ctx = { from: { id: 1 }, reply: replyMock, match: "" };
        await handler(ctx);
        expect(replyMock).toHaveBeenCalledOnce();
        expect(replyMock.mock.calls[0][0]).toBe(botModule.TXT_BOT_VISUALIZER_PROMPT);
        expect(lastWebAppArgs).toMatchObject({
            text: botModule.TXT_BOT_VISUALIZER_BUTTON,
            url: "https://example.test/visualizer?tgmini=1",
        });
    });

    it("replies with not-configured when NEXT_PUBLIC_SITE_URL is unset", async () => {
        delete process.env.NEXT_PUBLIC_SITE_URL;
        (globalThis as { __tgBot?: unknown }).__tgBot = undefined;
        vi.resetModules();
        lastWebAppArgs = null;
        botModule = await import("./bot");
        botModule.getBot();

        const handler = getHandler("visualizer");
        const ctx = { from: { id: 1 }, reply: replyMock, match: "" };
        await handler(ctx);
        expect(replyMock).toHaveBeenCalledOnce();
        expect(replyMock.mock.calls[0][0]).toBe(botModule.TXT_BOT_VISUALIZER_NOT_CONFIGURED);
        expect(lastWebAppArgs).toBeNull();
    });
});

describe("/help includes visualizer line (Property 11)", () => {
    it("contains TXT_BOT_HELP_VISUALIZER_LINE", async () => {
        const handler = getHandler("help");
        const ctx = { from: { id: 1 }, reply: replyMock, match: "" };
        await handler(ctx);
        expect(replyMock).toHaveBeenCalledOnce();
        const text = replyMock.mock.calls[0][0] as string;
        expect(text).toContain(botModule.TXT_BOT_HELP_VISUALIZER_LINE);
    });
});
