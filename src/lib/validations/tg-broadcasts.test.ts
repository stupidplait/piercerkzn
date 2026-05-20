/**
 * Validation contract tests for the telegram-broadcasts authoring schemas.
 *
 * Validates: Requirements 2.2, 2.4, 2.6, 2.10, 7.1, 7.2
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createBroadcastSchema,
    scheduleBroadcastSchema,
    testSendSchema,
    updateBroadcastSchema,
} from "./tg-broadcasts";

// ---------------------------------------------------------------------------
// Time control — `scheduleBroadcastSchema` calls `Date.now()` inside its
// refinement, so we freeze the clock for predictable boundary tests.
// ---------------------------------------------------------------------------
const FROZEN_NOW = new Date("2026-05-01T12:00:00Z");

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FROZEN_NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

// ===========================================================================
// createBroadcastSchema
// ===========================================================================
describe("createBroadcastSchema", () => {
    const baseValid = {
        title: "Заголовок",
        bodyText: "Тело сообщения с эмодзи 🎉",
    };

    it("accepts the minimal valid payload (title + bodyText only, parseMode defaults to HTML)", () => {
        const r = createBroadcastSchema.safeParse(baseValid);
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.parseMode).toBe("HTML");
    });

    it("accepts MarkdownV2 parseMode", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            parseMode: "MarkdownV2",
        });
        expect(r.success).toBe(true);
    });

    it("accepts both inline-button fields together (paired)", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            inlineButtonLabel: "Открыть",
            inlineButtonUrl: "https://piercerkzn.ru/promo",
        });
        expect(r.success).toBe(true);
    });

    it("accepts both inline-button fields null together", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            inlineButtonLabel: null,
            inlineButtonUrl: null,
        });
        expect(r.success).toBe(true);
    });

    it("accepts http:// (not just https://) inline button URL", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            inlineButtonLabel: "Open",
            inlineButtonUrl: "http://example.com",
        });
        expect(r.success).toBe(true);
    });

    // ---- negative cases ---------------------------------------------------
    it("rejects missing title", () => {
        const r = createBroadcastSchema.safeParse({
            bodyText: "тест",
        });
        expect(r.success).toBe(false);
    });

    it("rejects empty title (after trim)", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            title: "   ",
        });
        expect(r.success).toBe(false);
    });

    it("rejects title > 200 chars", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            title: "a".repeat(201),
        });
        expect(r.success).toBe(false);
    });

    it("rejects empty bodyText", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            bodyText: "",
        });
        expect(r.success).toBe(false);
    });

    it("rejects bodyText > 4000 chars", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            bodyText: "a".repeat(4001),
        });
        expect(r.success).toBe(false);
    });

    it("rejects parseMode outside {HTML, MarkdownV2}", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            parseMode: "Markdown",
        });
        expect(r.success).toBe(false);
    });

    it.each([
        ["javascript:", "javascript:alert(1)"],
        ["tg:", "tg://resolve?domain=foo"],
        ["mailto:", "mailto:hi@example.com"],
        ["data:", "data:text/html,<x>"],
        ["ftp:", "ftp://example.com"],
    ])("rejects inline button URL with %s scheme", (_label, url) => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            inlineButtonLabel: "Open",
            inlineButtonUrl: url,
        });
        expect(r.success).toBe(false);
    });

    it("rejects when only inlineButtonLabel is set", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            inlineButtonLabel: "Open",
        });
        expect(r.success).toBe(false);
    });

    it("rejects when only inlineButtonUrl is set", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            inlineButtonUrl: "https://example.com",
        });
        expect(r.success).toBe(false);
    });

    it("rejects inlineButtonLabel > 64 chars", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            inlineButtonLabel: "a".repeat(65),
            inlineButtonUrl: "https://example.com",
        });
        expect(r.success).toBe(false);
    });

    it("rejects inlineButtonUrl > 256 chars", () => {
        const r = createBroadcastSchema.safeParse({
            ...baseValid,
            inlineButtonLabel: "Open",
            inlineButtonUrl: "https://" + "a".repeat(260),
        });
        expect(r.success).toBe(false);
    });
});

// ===========================================================================
// updateBroadcastSchema
// ===========================================================================
describe("updateBroadcastSchema", () => {
    it("accepts an empty patch (no fields set)", () => {
        const r = updateBroadcastSchema.safeParse({});
        expect(r.success).toBe(true);
    });

    it("accepts a partial patch with only the title", () => {
        const r = updateBroadcastSchema.safeParse({ title: "Новый" });
        expect(r.success).toBe(true);
    });

    it("accepts setting both inline-button fields to null together", () => {
        const r = updateBroadcastSchema.safeParse({
            inlineButtonLabel: null,
            inlineButtonUrl: null,
        });
        expect(r.success).toBe(true);
    });

    it("rejects unpaired inline-button fields (only label)", () => {
        const r = updateBroadcastSchema.safeParse({
            inlineButtonLabel: "Open",
        });
        expect(r.success).toBe(false);
    });

    it("rejects unpaired inline-button fields (only URL)", () => {
        const r = updateBroadcastSchema.safeParse({
            inlineButtonUrl: "https://example.com",
        });
        expect(r.success).toBe(false);
    });
});

// ===========================================================================
// scheduleBroadcastSchema
// ===========================================================================
describe("scheduleBroadcastSchema", () => {
    it("accepts scheduledAt = now + 5 minutes", () => {
        const target = new Date(FROZEN_NOW.getTime() + 5 * 60_000).toISOString();
        const r = scheduleBroadcastSchema.safeParse({ scheduledAt: target });
        expect(r.success).toBe(true);
        if (r.success) {
            expect(r.data.scheduledAt).toBeInstanceOf(Date);
        }
    });

    it("accepts scheduledAt = now + exactly 1 minute (boundary)", () => {
        const target = new Date(FROZEN_NOW.getTime() + 60_000).toISOString();
        const r = scheduleBroadcastSchema.safeParse({ scheduledAt: target });
        expect(r.success).toBe(true);
    });

    it("rejects scheduledAt < now + 1 minute", () => {
        const target = new Date(FROZEN_NOW.getTime() + 30_000).toISOString();
        const r = scheduleBroadcastSchema.safeParse({ scheduledAt: target });
        expect(r.success).toBe(false);
    });

    it("rejects scheduledAt in the past", () => {
        const target = new Date(FROZEN_NOW.getTime() - 5 * 60_000).toISOString();
        const r = scheduleBroadcastSchema.safeParse({ scheduledAt: target });
        expect(r.success).toBe(false);
    });

    it("rejects non-ISO datetime strings", () => {
        const r = scheduleBroadcastSchema.safeParse({
            scheduledAt: "not-a-date",
        });
        expect(r.success).toBe(false);
    });
});

// ===========================================================================
// testSendSchema
// ===========================================================================
describe("testSendSchema", () => {
    it("accepts a numeric telegramId", () => {
        const r = testSendSchema.safeParse({ telegramId: 12_345 });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.telegramId).toBe(12_345);
    });

    it("accepts a string telegramId and parses to a number", () => {
        const r = testSendSchema.safeParse({ telegramId: "67890" });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.telegramId).toBe(67_890);
    });

    it("trims whitespace from string input before parsing", () => {
        const r = testSendSchema.safeParse({ telegramId: "  555  " });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.telegramId).toBe(555);
    });

    it("rejects negative integers", () => {
        const r = testSendSchema.safeParse({ telegramId: -10 });
        expect(r.success).toBe(false);
    });

    it("rejects zero", () => {
        const r = testSendSchema.safeParse({ telegramId: 0 });
        expect(r.success).toBe(false);
    });

    it("rejects non-integer floats", () => {
        const r = testSendSchema.safeParse({ telegramId: 3.14 });
        expect(r.success).toBe(false);
    });

    it("rejects non-numeric strings", () => {
        const r = testSendSchema.safeParse({ telegramId: "hello" });
        expect(r.success).toBe(false);
    });

    it("rejects when telegramId is missing", () => {
        const r = testSendSchema.safeParse({});
        expect(r.success).toBe(false);
    });
});
