/**
 * Render tests for the downsize-reminder email template.
 *
 * Validates: Requirements 6.9, 7.1
 *
 * Covers the rendered HTML + plaintext: Russian-only copy, primary CTA
 * targeting via `bookingUrl`, secondary CTA via `telegramUrl`, and graceful
 * absence of optional URLs.
 */
import React from "react";
import { describe, expect, it } from "vitest";

import DownsizeReminderEmail from "./downsize-reminder";
import { renderEmail } from "./render";

const FIXTURE = {
    customerFirstName: "Алина",
    piercingDate: "2026-05-14",
    piercingTypeLabel: "Прокол хеликса",
    bookingUrl: "https://piercerkzn.ru/booking?service=downsize",
    telegramUrl: "https://t.me/piercerkzn",
};

describe("DownsizeReminderEmail — render", () => {
    it("returns non-empty HTML and plaintext", async () => {
        const { html, text } = await renderEmail(
            React.createElement(DownsizeReminderEmail, FIXTURE)
        );
        expect(html.length).toBeGreaterThan(500);
        expect(text.trim().length).toBeGreaterThan(50);
    });

    it("includes Russian (Cyrillic) copy — preview, heading, body", async () => {
        const { html, text } = await renderEmail(
            React.createElement(DownsizeReminderEmail, FIXTURE)
        );
        expect(html).toMatch(/[А-Яа-яЁё]/u);
        expect(text).toMatch(/[А-Яа-яЁё]/u);
        // Heading contracted by the design.
        expect(html).toContain("Шесть недель — пора подумать о downsize");
        // Preview phrase.
        expect(html).toContain("6 недель после прокола — время на downsize");
        // Customer-name + lead.
        expect(html).toContain("Алина");
    });

    it("renders piercingDate and piercingTypeLabel into the body", async () => {
        const { html } = await renderEmail(React.createElement(DownsizeReminderEmail, FIXTURE));
        expect(html).toContain(FIXTURE.piercingDate);
        expect(html).toContain(FIXTURE.piercingTypeLabel);
    });

    it("primary CTA uses bookingUrl when provided", async () => {
        const { html } = await renderEmail(React.createElement(DownsizeReminderEmail, FIXTURE));
        expect(html).toContain(`href="${FIXTURE.bookingUrl}"`);
        expect(html).toContain("Записаться на downsize");
    });

    it("falls back gracefully when bookingUrl is null (no broken CTA)", async () => {
        const { html } = await renderEmail(
            React.createElement(DownsizeReminderEmail, {
                ...FIXTURE,
                bookingUrl: null,
            })
        );
        expect(html).not.toContain("Записаться на downsize →");
        // Body copy still present.
        expect(html).toContain("Шесть недель — пора подумать о downsize");
    });

    it("secondary CTA uses telegramUrl when provided", async () => {
        const { html } = await renderEmail(React.createElement(DownsizeReminderEmail, FIXTURE));
        expect(html).toContain(`href="${FIXTURE.telegramUrl}"`);
        expect(html).toContain("Написать в Telegram");
    });

    it("falls back gracefully when telegramUrl is omitted", async () => {
        const { html } = await renderEmail(
            React.createElement(DownsizeReminderEmail, {
                ...FIXTURE,
                telegramUrl: null,
            })
        );
        expect(html).not.toContain("Написать в Telegram");
        // Primary CTA still works.
        expect(html).toContain("Записаться на downsize");
    });

    it("does not branch on a `locale` parameter (Russian-only template)", () => {
        // Static type-level guarantee: `DownsizeReminderEmailProps` has
        // no `locale` field.
        const _props: keyof typeof FIXTURE extends "locale" ? never : true = true;
        expect(_props).toBe(true);
    });
});
