/**
 * /api/admin/newsletters/[id]/send
 *
 *   POST — trigger an immediate send. Allowed from `draft` or `scheduled`.
 *
 * The dispatcher CAS-flips the row into `sending`, then fans out per-recipient
 * jobs. Returns 409 when the campaign is in any other state (mapped from
 * `InvalidTransitionError`) or when `newsletter.from_address` is unset (the
 * dispatcher refuses to send without a configured sender).
 *
 * Requirements: 2.6, 2.11, 3.2, 3.3, 11.8
 */
import { applyRateLimit, fail, internal, notFound, ok, requireAdmin } from "@/lib/api";
import { InvalidTransitionError, runCampaign } from "@/lib/newsletters/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;

    try {
        const row = await runCampaign(id, { allowedFromStates: ["draft", "scheduled"] });
        return ok({ campaign: row });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            if (error.from === "unknown") {
                return notFound("Кампания не найдена");
            }
            return fail(
                "invalid_transition",
                `Нельзя отправить кампанию в состоянии «${error.from}»`,
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
        console.error("[/api/admin/newsletters/:id/send] failed", error);
        return internal();
    }
}
