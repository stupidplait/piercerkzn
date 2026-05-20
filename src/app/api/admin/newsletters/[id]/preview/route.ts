/**
 * /api/admin/newsletters/[id]/preview
 *
 *   POST — render the campaign through the React Email harness against a
 *          synthetic preview unsubscribe URL and return `{ html, text }`.
 *          No DB writes, no Resend call, no `notification_log` row.
 *
 * Read-only authoring helper: admin-bound, no rate-limit. The synthetic
 * unsubscribe URL is wired so the rendered footer link is structurally
 * identical to the production output but will not opt-out a real customer
 * if clicked from the preview pane.
 */
import React from "react";

import NewsletterCampaignEmail from "@/emails/newsletter-campaign";
import { renderEmail } from "@/emails/render";
import { internal, notFound, ok, requireAdmin } from "@/lib/api";
import { getCampaign } from "@/lib/newsletters/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(_req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;
    try {
        const campaign = await getCampaign(id);
        if (!campaign) return notFound("Кампания не найдена");

        const { html, text } = await renderEmail(
            React.createElement(NewsletterCampaignEmail, {
                customerFirstName: "Иван",
                subject: campaign.subject,
                preheader: campaign.preheader,
                bodyMarkdown: campaign.bodyMarkdown,
                unsubscribeUrl: "https://piercerkzn.ru/api/unsubscribe?token=preview",
            })
        );
        return ok({ html, text });
    } catch (error) {
        console.error("[/api/admin/newsletters/:id/preview] failed", error);
        return internal();
    }
}
