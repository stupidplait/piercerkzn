/**
 * Telegram broadcast render unit tests.
 *
 * Pure module — no DB, no I/O, no mocks needed. Drives `renderBroadcastPayload`
 * over the full (parseMode × button-set × button-unset × invalid-URL ×
 * invalid-parseMode) cross-product and asserts the exact payload shape.
 *
 * Validates: Requirements 7.1, 7.2, 7.3
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import type { TelegramBroadcast } from "@/db";

import { renderBroadcastPayload } from "./render";

// ---------------------------------------------------------------------------
// Fixture builder
// ---------------------------------------------------------------------------
function makeBroadcast(overrides: Partial<TelegramBroadcast> = {}): TelegramBroadcast {
    return {
        id: "b-uuid",
        title: "Заголовок",
        bodyText: "Привет! Это тестовая рассылка.",
        parseMode: "HTML",
        inlineButtonLabel: null,
        inlineButtonUrl: null,
        state: "draft",
        scheduledAt: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        recipientCount: 0,
        sentCount: 0,
        failedCount: 0,
        createdByUserId: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-01T00:00:00Z"),
        ...overrides,
    } as TelegramBroadcast;
}

// ===========================================================================
// Property 10 — payload shape & error semantics
// Validates: Requirements 7.1, 7.2, 7.3
// ===========================================================================
describe("renderBroadcastPayload — Property 10: shape & errors", () => {
    it("HTML parseMode without inline button produces text + parse_mode only", () => {
        const b = makeBroadcast({
            bodyText: "Тест HTML",
            parseMode: "HTML",
            inlineButtonLabel: null,
            inlineButtonUrl: null,
        });

        const payload = renderBroadcastPayload(b);

        expect(payload).toEqual({
            text: "Тест HTML",
            parse_mode: "HTML",
        });
        expect("reply_markup" in payload).toBe(false);
    });

    it("MarkdownV2 parseMode without inline button produces text + parse_mode only", () => {
        const b = makeBroadcast({
            bodyText: "Тест MarkdownV2",
            parseMode: "MarkdownV2",
        });
        const payload = renderBroadcastPayload(b);
        expect(payload).toEqual({
            text: "Тест MarkdownV2",
            parse_mode: "MarkdownV2",
        });
    });

    it("both inline-button fields set → reply_markup is a single-button single-row inline keyboard", () => {
        const b = makeBroadcast({
            bodyText: "С кнопкой",
            parseMode: "HTML",
            inlineButtonLabel: "Открыть",
            inlineButtonUrl: "https://piercerkzn.ru/promo",
        });

        const payload = renderBroadcastPayload(b);

        expect(payload).toEqual({
            text: "С кнопкой",
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [[{ text: "Открыть", url: "https://piercerkzn.ru/promo" }]],
            },
        });
        // The deep-equals above already pins the [[…]] shape, but assert it
        // again so a future refactor that flattens the nesting still fails.
        expect(payload.reply_markup?.inline_keyboard).toHaveLength(1);
        expect(payload.reply_markup?.inline_keyboard[0]).toHaveLength(1);
    });

    it("only inline button label set → reply_markup omitted (silently)", () => {
        const b = makeBroadcast({
            inlineButtonLabel: "Open",
            inlineButtonUrl: null,
        });
        const payload = renderBroadcastPayload(b);
        expect("reply_markup" in payload).toBe(false);
    });

    it("only inline button URL set → reply_markup omitted (silently)", () => {
        const b = makeBroadcast({
            inlineButtonLabel: null,
            inlineButtonUrl: "https://example.com",
        });
        const payload = renderBroadcastPayload(b);
        expect("reply_markup" in payload).toBe(false);
    });

    it("invalid parseMode throws", () => {
        const b = makeBroadcast({
            // deliberately invalid — bypass the type system to simulate a
            // bad row that somehow made it past the zod refinement.
            parseMode: "Markdown" as unknown as TelegramBroadcast["parseMode"],
        });
        expect(() => renderBroadcastPayload(b)).toThrow(/invalid parse_mode/);
    });

    it("non-http(s) inline button URL throws when both fields are set", () => {
        const b = makeBroadcast({
            inlineButtonLabel: "Бесплатный звонок",
            inlineButtonUrl: "javascript:alert(1)",
        });
        expect(() => renderBroadcastPayload(b)).toThrow(/invalid inline button URL scheme/);
    });

    it("tg:// URL is rejected", () => {
        const b = makeBroadcast({
            inlineButtonLabel: "Открыть в Telegram",
            inlineButtonUrl: "tg://resolve?domain=piercerkzn",
        });
        expect(() => renderBroadcastPayload(b)).toThrow(/invalid inline button URL scheme/);
    });

    it("mailto: URL is rejected", () => {
        const b = makeBroadcast({
            inlineButtonLabel: "Написать",
            inlineButtonUrl: "mailto:hi@piercerkzn.ru",
        });
        expect(() => renderBroadcastPayload(b)).toThrow(/invalid inline button URL scheme/);
    });

    it("returned `text` byte-equals broadcast.bodyText (no normalisation)", () => {
        const body = "Многострочный\nтекст с эмодзи 🎉 и пробелами  ";
        const b = makeBroadcast({ bodyText: body });
        expect(renderBroadcastPayload(b).text).toBe(body);
    });

    // --- fast-check: drive the full (parseMode × button-set) cross-product ---
    it("fc — valid combos always produce the documented payload shape", () => {
        fcAssert(
            fc.property(
                fc.constantFrom<"HTML" | "MarkdownV2">("HTML", "MarkdownV2"),
                fc.string({ minLength: 1, maxLength: 100 }),
                fc.option(
                    fc.tuple(
                        fc.string({ minLength: 1, maxLength: 64 }),
                        fc.constantFrom("https://", "http://").chain((scheme) =>
                            fc
                                .string({ minLength: 1, maxLength: 50 })
                                .filter((s) => !s.includes(" ") && !s.includes("\n"))
                                .map((p) => `${scheme}${p}`)
                        )
                    ),
                    { nil: null }
                ),
                (parseMode, body, button) => {
                    const b = makeBroadcast({
                        parseMode,
                        bodyText: body,
                        inlineButtonLabel: button ? button[0] : null,
                        inlineButtonUrl: button ? button[1] : null,
                    });
                    const payload = renderBroadcastPayload(b);

                    if (payload.text !== body) return false;
                    if (payload.parse_mode !== parseMode) return false;

                    if (button === null) {
                        return !("reply_markup" in payload);
                    }
                    if (!payload.reply_markup) return false;
                    const cell = payload.reply_markup.inline_keyboard[0]?.[0];
                    return cell?.text === button[0] && cell?.url === button[1];
                }
            ),
            { numRuns: 80, seed: 9_001 }
        );
    });

    it("fc — invalid URL schemes always throw when both button fields are set", () => {
        fcAssert(
            fc.property(
                fc.constantFrom<string>("javascript:", "data:", "tg:", "mailto:", "ftp:", "file:"),
                fc.string({ minLength: 1, maxLength: 30 }),
                fc.string({ minLength: 1, maxLength: 30 }),
                (scheme, host, label) => {
                    const b = makeBroadcast({
                        inlineButtonLabel: label,
                        inlineButtonUrl: `${scheme}//${host}`,
                    });
                    try {
                        renderBroadcastPayload(b);
                        return false;
                    } catch (err) {
                        return /invalid inline button URL scheme/.test(
                            err instanceof Error ? err.message : String(err)
                        );
                    }
                }
            ),
            { numRuns: 30, seed: 4_711 }
        );
    });

    it("fc — invalid parseMode always throws", () => {
        fcAssert(
            fc.property(
                fc
                    .string({ minLength: 1, maxLength: 20 })
                    .filter((s) => s !== "HTML" && s !== "MarkdownV2"),
                (badMode) => {
                    const b = makeBroadcast({
                        parseMode: badMode as unknown as TelegramBroadcast["parseMode"],
                    });
                    try {
                        renderBroadcastPayload(b);
                        return false;
                    } catch (err) {
                        return /invalid parse_mode/.test(
                            err instanceof Error ? err.message : String(err)
                        );
                    }
                }
            ),
            { numRuns: 30, seed: 6_002 }
        );
    });
});
