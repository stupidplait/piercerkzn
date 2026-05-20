/**
 * /api/admin/newsletters/[id]/test-send
 *
 *   POST — render the campaign and dispatch a single test email to the
 *          provided address.
 *
 * Bypasses the production fanout path: no `notification_log` row is
 * inserted and the campaign's `recipientCount` / `sentCount` / `failedCount`
 * counters are not touched (per the spec's test-send contract). The test
 * recipient receives an email structurally identical to a real broadcast,
 * tagged with a `[TEST]` subject prefix and a synthetic unsubscribe URL so
 * a stray click cannot opt-out a real customer.
 *
 * Returns 409 when `newsletter.from_address` is unset (the dispatcher
 * refuses to send without a configured sender).
 *
 * Requirements: 2.10, 2.11
 */
import React from "react";

import NewsletterCampaignEmail from "@/emails/newsletter-campaign";
import { renderEmail } from "@/emails/render";
import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { getCampaign } from "@/lib/newsletters/dispatch";
import { sendEmail } from "@/lib/resend";
import { getNewsletterSettings } from "@/lib/settings";
import { testSendSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;
    const parsed = await parseJson(req, testSendSchema);
    if (!parsed.ok) return parsed.response!;

    try {
        const campaign = await getCampaign(id);
        if (!campaign) return notFound("Кампания не найдена");

        const settings = await getNewsletterSettings();
        if (!settings.fromAddress) {
            return fail(
                "from_address_unset",
                "Адрес отправителя newsletter.from_address не настроен",
                { status: 409 }
            );
        }

        // Synthetic unsubscribe URL — test sends are throwaway, so we use a
        // placeholder that visibly identifies the email as a test and won't
        // verify against a real customer's HMAC.
        const unsubscribeUrl = "https://piercerkzn.ru/api/unsubscribe?token=test-send";

        const { html, text } = await renderEmail(
            React.createElement(NewsletterCampaignEmail, {
                customerFirstName: null,
                subject: campaign.subject,
                preheader: campaign.preheader,
                bodyMarkdown: campaign.bodyMarkdown,
                unsubscribeUrl,
            })
        );

        const messageId = await sendEmail({
            to: parsed.data!.to,
            subject: `[TEST] ${campaign.subject}`,
            html,
            text,
            from: settings.fromAddress,
            replyTo: settings.replyTo ?? settings.fromAddress,
            headers: {
                "List-Unsubscribe": `<${unsubscribeUrl}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                "Content-Language": "ru",
            },
        });

        return ok({ messageId });
    } catch (error) {
        console.error("[/api/admin/newsletters/:id/test-send] failed", error);
        return internal();
    }
}
