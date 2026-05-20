/**
 * /api/admin/newsletters/[id]
 *
 *   GET    — fetch a single campaign or 404.
 *   PATCH  — update a draft campaign. Returns 409 if the campaign is not
 *            in `draft` (mapped from `InvalidTransitionError`).
 *   DELETE — delete a campaign. Returns 409 if the campaign is not in
 *            `draft` or `cancelled` (mapped from `InvalidTransitionError`).
 *
 * State-machine rejections surface as HTTP 409 with body
 * `{ error: { code: "invalid_transition", message, details: { from, action } } }`
 * per the design's canonical shape.
 */
import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import {
    deleteCampaign,
    getCampaign,
    InvalidTransitionError,
    updateCampaign,
} from "@/lib/newsletters/dispatch";
import { updateCampaignSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;
    try {
        const row = await getCampaign(id);
        if (!row) return notFound("Кампания не найдена");
        return ok({ campaign: row });
    } catch (error) {
        console.error("[/api/admin/newsletters/:id GET] failed", error);
        return internal();
    }
}

export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;
    const parsed = await parseJson(req, updateCampaignSchema);
    if (!parsed.ok) return parsed.response!;

    try {
        const row = await updateCampaign(id, parsed.data!);
        return ok({ campaign: row });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            if (error.from === "unknown") {
                return notFound("Кампания не найдена");
            }
            return fail(
                "invalid_transition",
                `Нельзя редактировать кампанию в состоянии «${error.from}»`,
                { status: 409, details: { from: error.from, action: error.action } }
            );
        }
        console.error("[/api/admin/newsletters/:id PATCH] failed", error);
        return internal();
    }
}

export async function DELETE(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;
    try {
        await deleteCampaign(id);
        return ok({ deleted: true });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            if (error.from === "unknown") {
                return notFound("Кампания не найдена");
            }
            return fail(
                "invalid_transition",
                `Нельзя удалить кампанию в состоянии «${error.from}»`,
                { status: 409, details: { from: error.from, action: error.action } }
            );
        }
        console.error("[/api/admin/newsletters/:id DELETE] failed", error);
        return internal();
    }
}
