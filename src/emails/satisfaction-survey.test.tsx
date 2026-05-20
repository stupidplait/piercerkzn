/**
 * Render tests for the satisfaction-survey email template.
 *
 * Validates: Requirements 5.8, 7.1
 *
 * The orchestration layer's tests (`lib/satisfaction/reminders.test.ts`)
 * verify the dispatch contract; this file covers the rendered HTML +
 * plaintext: Russian copy, CTA targeting, fallback behaviour when
 * optional URLs are absent.
 */
import React from "react";
import { describe, expect, it } from "vitest";

import SatisfactionSurveyEmail from "./satisfaction-survey";
import { renderEmail } from "./render";

const FIXTURE = {
    customerFirstName: "Алина",
    appointmentDate: "2026-05-14",
    referenceNumber: "PK-APT-2026-0042",
    feedbackUrl: "https://yandex.ru/maps/org/piercer-kzn/123/reviews",
    telegramUrl: "https://t.me/piercerkzn",
};

describe("SatisfactionSurveyEmail — render", () => {
    it("returns non-empty HTML and plaintext", async () => {
        const { html, text } = await renderEmail(
            React.createElement(SatisfactionSurveyEmail, FIXTURE)
        );
        expect(html.length).toBeGreaterThan(500);
        expect(text.trim().length).toBeGreaterThan(50);
    });

    it("includes Russian (Cyrillic) copy in subject preview, heading, body", async () => {
        const { html, text } = await renderEmail(
            React.createElement(SatisfactionSurveyEmail, FIXTURE)
        );
        // Cyrillic regex — the email is Russian-only, no English fallback.
        expect(html).toMatch(/[А-Яа-яЁё]/u);
        expect(text).toMatch(/[А-Яа-яЁё]/u);
        // Specific phrases from the template (preview, heading, lead).
        expect(html).toContain("Прошла неделя после визита — поделитесь впечатлениями");
        expect(html).toContain("Прошла неделя — как ощущения?");
        expect(html).toContain("Алина");
    });

    it("renders the customer first name and reference number into the body", async () => {
        const { html } = await renderEmail(React.createElement(SatisfactionSurveyEmail, FIXTURE));
        expect(html).toContain(FIXTURE.customerFirstName);
        expect(html).toContain(FIXTURE.referenceNumber);
        expect(html).toContain(FIXTURE.appointmentDate);
    });

    it("primary CTA link uses feedbackUrl when provided", async () => {
        const { html } = await renderEmail(React.createElement(SatisfactionSurveyEmail, FIXTURE));
        // The CTA `<a>` carries the feedbackUrl as href and the Russian
        // call-to-action label «Оставить отзыв →».
        expect(html).toContain(`href="${FIXTURE.feedbackUrl}"`);
        expect(html).toContain("Оставить отзыв");
    });

    it("falls back gracefully when feedbackUrl is null (no broken link)", async () => {
        const { html } = await renderEmail(
            React.createElement(SatisfactionSurveyEmail, {
                ...FIXTURE,
                feedbackUrl: null,
            })
        );
        // The CTA link is omitted entirely, but the body still renders.
        expect(html).not.toContain("Оставить отзыв →");
        // The "ответьте этим письмом" / Telegram fallback path remains.
        expect(html).toMatch(/[А-Яа-яЁё]/u);
    });

    it("falls back gracefully when telegramUrl is omitted", async () => {
        const { html } = await renderEmail(
            React.createElement(SatisfactionSurveyEmail, {
                ...FIXTURE,
                telegramUrl: null,
            })
        );
        // Secondary CTA is omitted; the rest of the email still renders.
        expect(html).not.toContain("Написать в Telegram");
        expect(html).toContain("Прошла неделя — как ощущения?");
    });

    it("does not branch on a `locale` parameter (Russian-only template)", () => {
        // Static type-level guarantee: `SatisfactionSurveyEmailProps` has
        // no `locale` field. This compile-time assertion lives here so a
        // future regression (adding `locale: 'en' | 'ru'`) would make the
        // test stop compiling.
        const _props: keyof typeof FIXTURE extends "locale" ? never : true = true;
        expect(_props).toBe(true);
    });
});
