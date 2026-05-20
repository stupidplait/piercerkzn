/**
 * /api/admin/newsletters/[id]/schedule
 *
 *   POST — schedule a draft campaign for future dispatch.
 *
 * Returns 409 when the campaign is not in `draft` (mapped from
 * `InvalidTransitionError`) or when `newsletter.from_address` is unset
 * (the dispatcher refuses to schedule without a configured sender).
 *
 * Requirements: 2.5, 2.11, 3.1, 11.8
 */
import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { InvalidTransitionError, scheduleCampaign } from "@/lib/newsletters/dispatch";
import { scheduleCampaignSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;
    const parsed = await parseJson(req, scheduleCampaignSchema);
    if (!parsed.ok) return parsed.response!;

    try {
        const row = await scheduleCampaign(id, parsed.data!.scheduledAt);
        return ok({ campaign: row });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            if (error.from === "unknown") {
                return notFound("Кампания не найдена");
            }
            return fail(
                "invalid_transition",
                `Нельзя запланировать кампанию в состоянии «${error.from}»`,
                { status: 409, details: { from: error.from, action: error.action } }
            );
        }
        if (error instanceof Error && error.message === "from_address_unset") {
            return fail(
                "from_address_unset",
                "Адрес отправителя newsletter.from_address не настроен",
                { status: 409 }
            );
        }
        console.error("[/api/admin/newsletters/:id/schedule] failed", error);
        return internal();
    }
}
