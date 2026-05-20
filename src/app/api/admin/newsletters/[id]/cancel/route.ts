/**
 * /api/admin/newsletters/[id]/cancel
 *
 *   POST — cancel a campaign. Allowed from `draft`, `scheduled`, or `sending`.
 *
 * State-machine rejections surface as HTTP 409 with body
 * `{ error: { code: "invalid_transition", message, details: { from, action } } }`.
 * Missing rows return 404.
 *
 * Requirements: 2.7, 2.11, 3.5
 */
import { applyRateLimit, fail, internal, notFound, ok, requireAdmin } from "@/lib/api";
import { cancelCampaign, InvalidTransitionError } from "@/lib/newsletters/dispatch";

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
    try {
        const row = await cancelCampaign(id);
        return ok({ campaign: row });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            if (error.from === "unknown") {
                return notFound("Кампания не найдена");
            }
            return fail(
                "invalid_transition",
                `Нельзя отменить кампанию в состоянии «${error.from}»`,
                { status: 409, details: { from: error.from, action: error.action } }
            );
        }
        console.error("[/api/admin/newsletters/:id/cancel] failed", error);
        return internal();
    }
}
