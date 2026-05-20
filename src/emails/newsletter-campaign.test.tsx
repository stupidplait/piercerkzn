/**
 * Render tests for the newsletter campaign email template.
 *
 * Validates: Requirements 10.1, 10.3
 *
 * Covers Russian static-copy markers, the unsubscribe URL surfaced in the
 * footer, and the in-line Markdown→React Email rendering of the body.
 */
import React from "react";
import { describe, expect, it } from "vitest";

import NewsletterCampaignEmail from "./newsletter-campaign";
import { renderEmail } from "./render";

const FIXTURE = {
    customerFirstName: "Алина",
    subject: "Майская акция — скидка 15%",
    preheader: "Только до конца мая — украшения по сниженной цене",
    bodyMarkdown:
        "# Привет!\n\nВ этом месяце мы дарим скидку **15%** на _всю коллекцию_.\n\n- Золото\n- Титан\n- Серебро\n\nЗабронировать визит можно [здесь](https://piercerkzn.ru/booking).",
    unsubscribeUrl: "https://piercerkzn.ru/api/unsubscribe?token=Y3VzdG9tZXItMDAx.deadbeef",
};

describe("NewsletterCampaignEmail — render", () => {
    it("returns non-empty HTML and plaintext", async () => {
        const { html, text } = await renderEmail(
            React.createElement(NewsletterCampaignEmail, FIXTURE)
        );
        expect(html.length).toBeGreaterThan(500);
        expect(text.trim().length).toBeGreaterThan(50);
    });

    it("contains the Russian static-copy markers", async () => {
        const { html, text } = await renderEmail(
            React.createElement(NewsletterCampaignEmail, FIXTURE)
        );
        // Greeting with name.
        expect(html).toContain("Здравствуйте, Алина!");
        // Footer line + unsubscribe + brand line.
        expect(html).toContain(
            "Вы получили это письмо, потому что подписались на новости PiercerKZN."
        );
        expect(html).toContain("Отписаться от рассылки");
        expect(html).toContain("PiercerKZN — пирсинг-студия в Казани");
        // Plaintext form must also carry the Cyrillic copy.
        expect(text).toMatch(/[А-Яа-яЁё]/u);
        expect(text).toContain("Здравствуйте, Алина");
        expect(text).toContain("Отписаться от рассылки");
    });

    it("falls back to «Здравствуйте!» when first name is absent", async () => {
        const { html } = await renderEmail(
            React.createElement(NewsletterCampaignEmail, {
                ...FIXTURE,
                customerFirstName: undefined,
            })
        );
        expect(html).toContain("Здравствуйте!");
        expect(html).not.toContain("Здравствуйте, ");
    });

    it("falls back to «Здравствуйте!» when first name is null", async () => {
        const { html } = await renderEmail(
            React.createElement(NewsletterCampaignEmail, {
                ...FIXTURE,
                customerFirstName: null,
            })
        );
        expect(html).toContain("Здравствуйте!");
    });

    it("surfaces the unsubscribe URL in the footer link", async () => {
        const { html, text } = await renderEmail(
            React.createElement(NewsletterCampaignEmail, FIXTURE)
        );
        expect(html).toContain(`href="${FIXTURE.unsubscribeUrl}"`);
        expect(html).toContain("?token=");
        // Plaintext form contains the literal URL too.
        expect(text).toContain(FIXTURE.unsubscribeUrl);
    });

    it("renders the body markdown through the shared renderer", async () => {
        const { html } = await renderEmail(React.createElement(NewsletterCampaignEmail, FIXTURE));
        // Heading → <h1> tag from the markdown renderer.
        expect(html).toMatch(/<h1[^>]*>\s*Привет!\s*<\/h1>/);
        // Bold inline → <strong>15%</strong>.
        expect(html).toContain("<strong>15%</strong>");
        // Italic inline → <em>всю коллекцию</em>.
        expect(html).toContain("<em>всю коллекцию</em>");
        // List items.
        expect(html).toContain("Золото");
        expect(html).toContain("Титан");
        expect(html).toContain("Серебро");
        // Inline link with allowed scheme.
        expect(html).toContain('href="https://piercerkzn.ru/booking"');
        expect(html).toContain("здесь");
    });

    it("uses the preheader as the inbox preview when provided", async () => {
        const { html } = await renderEmail(React.createElement(NewsletterCampaignEmail, FIXTURE));
        expect(html).toContain("Только до конца мая");
    });

    it("falls back to subject for the preview when preheader is absent", async () => {
        const { html } = await renderEmail(
            React.createElement(NewsletterCampaignEmail, {
                ...FIXTURE,
                preheader: null,
            })
        );
        // The subject ends up rendered as the preview line.
        expect(html).toContain(FIXTURE.subject);
    });

    it("never emits a <script> tag even when bodyMarkdown contains raw HTML", async () => {
        const { html } = await renderEmail(
            React.createElement(NewsletterCampaignEmail, {
                ...FIXTURE,
                bodyMarkdown: "<script>alert(1)</script>\n\n# Hi",
            })
        );
        expect(html).not.toMatch(/<script\b/i);
        expect(html).toContain("&lt;script&gt;");
    });
});
