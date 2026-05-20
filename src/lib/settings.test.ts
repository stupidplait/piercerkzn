/**
 * Unit tests for the typed settings reader (`lib/settings.ts`).
 *
 * Mocks `@/db` with a queue of rows for the `select(...).from(...).where(...)`
 * chain, and `@/lib/cache` with a pass-through `getOrSet`/`delByPattern` so
 * we can drive the loader from the tests without a real Redis connection.
 *
 * Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5  (telegram broadcast block)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { dbState, queueRows, dbModule, delByPatternMock } = vi.hoisted(() => {
    interface SettingRow {
        key: string;
        value: unknown;
    }

    const dbState: { rows: SettingRow[] } = { rows: [] };

    function queueRows(rows: SettingRow[]) {
        dbState.rows = rows;
    }

    const settings = { __table: "settings", key: "key", value: "value" } as const;

    function makeChain() {
        const obj = {
            from: () => obj,
            where: () => obj,
            then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
                return Promise.resolve(dbState.rows).then(resolve, reject);
            },
            catch(reject: (e: unknown) => unknown) {
                return Promise.resolve(dbState.rows).catch(reject);
            },
        };
        return obj;
    }

    const dbModule = {
        db: {
            select: () => ({
                from: (_t: unknown) => makeChain(),
            }),
        },
        settings,
    };

    return {
        dbState,
        queueRows,
        dbModule,
        delByPatternMock: vi.fn(async () => 0),
    };
});

vi.mock("@/db", () => dbModule);

// `getOrSet` is replaced with a pass-through that just calls the loader so
// every test is isolated and we avoid the Redis path entirely. The
// settings reader's caching behaviour is exercised by the cache module's
// own test suite.
vi.mock("@/lib/cache", () => ({
    cacheKey: { bookingSettings: () => "settings:booking" },
    getOrSet: <T>(_ns: string, _opts: unknown, loader: () => Promise<T>) => loader(),
    delByPattern: delByPatternMock,
}));

vi.mock("drizzle-orm", () => ({
    inArray: (..._a: unknown[]) => null,
}));

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import {
    getNewsletterSettings,
    getTelegramBroadcastSettings,
    invalidateSettingsCache,
    NEWSLETTER_SETTINGS_DEFAULTS,
    TG_BROADCAST_SETTINGS_DEFAULTS,
} from "./settings";

beforeEach(() => {
    queueRows([]);
    delByPatternMock.mockReset().mockResolvedValue(0);
});

afterEach(() => {
    vi.clearAllMocks();
});

// ===========================================================================
// Property 13 — telegram broadcast settings power-set semantics
// Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5
// ===========================================================================
describe("getTelegramBroadcastSettings — Property 13: present keys parsed, missing keys defaulted", () => {
    it("returns documented defaults when no rows are present", async () => {
        queueRows([]);
        const result = await getTelegramBroadcastSettings();
        expect(result).toEqual({
            chunkSize: 30,
            chunkDelayMs: 1100,
            stuckAfterMs: 30 * 60 * 1000,
            parseMode: "HTML",
        });
        expect(result).toEqual(TG_BROADCAST_SETTINGS_DEFAULTS);
    });

    it("parses chunk_size from { number } shape", async () => {
        queueRows([{ key: "tg.broadcast.chunk_size", value: { number: 50 } }]);
        const r = await getTelegramBroadcastSettings();
        expect(r.chunkSize).toBe(50);
        // Other keys still defaulted.
        expect(r.chunkDelayMs).toBe(1100);
        expect(r.stuckAfterMs).toBe(30 * 60 * 1000);
        expect(r.parseMode).toBe("HTML");
    });

    it("parses chunk_delay_ms + stuck_after_ms from { number } shape", async () => {
        queueRows([
            { key: "tg.broadcast.chunk_delay_ms", value: { number: 2_000 } },
            { key: "tg.broadcast.stuck_after_ms", value: { number: 60 * 60 * 1000 } },
        ]);
        const r = await getTelegramBroadcastSettings();
        expect(r.chunkDelayMs).toBe(2_000);
        expect(r.stuckAfterMs).toBe(60 * 60 * 1000);
    });

    it("parses parse_mode from { text } shape when in {HTML, MarkdownV2}", async () => {
        queueRows([{ key: "tg.broadcast.parse_mode", value: { text: "MarkdownV2" } }]);
        const r = await getTelegramBroadcastSettings();
        expect(r.parseMode).toBe("MarkdownV2");
    });

    it("falls back to default parseMode when stored value is outside the enum", async () => {
        queueRows([{ key: "tg.broadcast.parse_mode", value: { text: "Markdown" } }]);
        const r = await getTelegramBroadcastSettings();
        expect(r.parseMode).toBe("HTML");
    });

    it("falls back to default chunk_size when stored value is the wrong shape", async () => {
        queueRows([
            // Wrong: stored as text rather than number.
            { key: "tg.broadcast.chunk_size", value: { text: "fifty" } },
        ]);
        const r = await getTelegramBroadcastSettings();
        expect(r.chunkSize).toBe(30);
    });

    it("returns all four overridden values together", async () => {
        queueRows([
            { key: "tg.broadcast.chunk_size", value: { number: 25 } },
            { key: "tg.broadcast.chunk_delay_ms", value: { number: 500 } },
            { key: "tg.broadcast.stuck_after_ms", value: { number: 15 * 60 * 1000 } },
            { key: "tg.broadcast.parse_mode", value: { text: "MarkdownV2" } },
        ]);
        const r = await getTelegramBroadcastSettings();
        expect(r).toEqual({
            chunkSize: 25,
            chunkDelayMs: 500,
            stuckAfterMs: 15 * 60 * 1000,
            parseMode: "MarkdownV2",
        });
    });

    it("ignores unrelated rows without disturbing the returned shape", async () => {
        queueRows([
            { key: "newsletter.chunk_size", value: { number: 999 } },
            { key: "booking.slot_duration_minutes", value: { number: 60 } },
            { key: "tg.broadcast.chunk_size", value: { number: 7 } },
        ]);
        const r = await getTelegramBroadcastSettings();
        // Note: the loader's WHERE filter is `inArray(...)`, mocked to a
        // no-op here; in real DB calls Postgres would do this filter, but
        // the loader still maps by key so unrelated rows are inert.
        expect(r.chunkSize).toBe(7);
        expect(r.parseMode).toBe("HTML");
    });
});

// ===========================================================================
// invalidateSettingsCache drops the `settings:tg-broadcast` namespace
// ===========================================================================
describe("invalidateSettingsCache — drops the tg-broadcast namespace", () => {
    it("calls delByPattern('settings:*') which globs the tg-broadcast key", async () => {
        await invalidateSettingsCache();
        expect(delByPatternMock).toHaveBeenCalledTimes(1);
        expect(delByPatternMock).toHaveBeenCalledWith("settings:*");
    });
});

// ===========================================================================
// Newsletter — getNewsletterSettings
// Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5
// ===========================================================================
describe("getNewsletterSettings — defaults vs persisted values", () => {
    it("returns documented defaults when no rows are present", async () => {
        queueRows([]);
        const result = await getNewsletterSettings();
        expect(result).toEqual({
            fromAddress: null,
            replyTo: null,
            chunkSize: 50,
            chunkDelayMs: 200,
            stuckAfterMs: 30 * 60 * 1000,
        });
        expect(result).toEqual(NEWSLETTER_SETTINGS_DEFAULTS);
    });

    it("parses fromAddress + replyTo from { text } shape", async () => {
        queueRows([
            {
                key: "newsletter.from_address",
                value: { text: "studio@piercerkzn.ru" },
            },
            {
                key: "newsletter.reply_to",
                value: { text: "hello@piercerkzn.ru" },
            },
        ]);
        const r = await getNewsletterSettings();
        expect(r.fromAddress).toBe("studio@piercerkzn.ru");
        expect(r.replyTo).toBe("hello@piercerkzn.ru");
        // Unset numeric fields fall back.
        expect(r.chunkSize).toBe(50);
        expect(r.chunkDelayMs).toBe(200);
        expect(r.stuckAfterMs).toBe(30 * 60 * 1000);
    });

    it("parses chunkSize / chunkDelayMs / stuckAfterMs from { number } shape", async () => {
        queueRows([
            { key: "newsletter.chunk_size", value: { number: 100 } },
            { key: "newsletter.chunk_delay_ms", value: { number: 500 } },
            {
                key: "newsletter.stuck_after_ms",
                value: { number: 60 * 60 * 1000 },
            },
        ]);
        const r = await getNewsletterSettings();
        expect(r.chunkSize).toBe(100);
        expect(r.chunkDelayMs).toBe(500);
        expect(r.stuckAfterMs).toBe(60 * 60 * 1000);
        // Text fields default to null when no row is present.
        expect(r.fromAddress).toBeNull();
        expect(r.replyTo).toBeNull();
    });

    it("returns all five overridden values together", async () => {
        queueRows([
            {
                key: "newsletter.from_address",
                value: { text: "noreply@piercerkzn.ru" },
            },
            {
                key: "newsletter.reply_to",
                value: { text: "support@piercerkzn.ru" },
            },
            { key: "newsletter.chunk_size", value: { number: 75 } },
            { key: "newsletter.chunk_delay_ms", value: { number: 250 } },
            {
                key: "newsletter.stuck_after_ms",
                value: { number: 45 * 60 * 1000 },
            },
        ]);
        const r = await getNewsletterSettings();
        expect(r).toEqual({
            fromAddress: "noreply@piercerkzn.ru",
            replyTo: "support@piercerkzn.ru",
            chunkSize: 75,
            chunkDelayMs: 250,
            stuckAfterMs: 45 * 60 * 1000,
        });
    });

    it("falls back to default chunkSize when stored value is the wrong shape", async () => {
        queueRows([{ key: "newsletter.chunk_size", value: { text: "fifty" } }]);
        const r = await getNewsletterSettings();
        expect(r.chunkSize).toBe(50);
    });

    it("falls back to null fromAddress when stored value is the wrong shape", async () => {
        queueRows([{ key: "newsletter.from_address", value: { number: 42 } }]);
        const r = await getNewsletterSettings();
        expect(r.fromAddress).toBeNull();
    });

    it("ignores unrelated rows", async () => {
        queueRows([
            { key: "tg.broadcast.chunk_size", value: { number: 999 } },
            { key: "newsletter.chunk_size", value: { number: 7 } },
        ]);
        const r = await getNewsletterSettings();
        expect(r.chunkSize).toBe(7);
    });
});

describe("invalidateSettingsCache — drops the newsletter namespace", () => {
    it("calls delByPattern('settings:*') which globs the newsletter key", async () => {
        await invalidateSettingsCache();
        expect(delByPatternMock).toHaveBeenCalledTimes(1);
        expect(delByPatternMock).toHaveBeenCalledWith("settings:*");
    });
});
