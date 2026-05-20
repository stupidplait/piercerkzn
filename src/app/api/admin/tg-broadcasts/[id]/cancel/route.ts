/**
 * /api/admin/tg-broadcasts/[id]/cancel
 *
 *   POST — cancel a telegram broadcast. Allowed from `draft`, `scheduled`,
 *   or `sending`.
 *
 * State-machine rejections surface as HTTP 409 with body
 * `{ error: { code: "invalid_transition", message, details: { from, action } } }`.
 * Missing rows return 404.
 *
 * Requirements: 2.8, 3.3, 3.7
 */
import { applyRateLimit, fail, internal, notFound, ok, requireAdmin } from "@/lib/api";
import { cancelBroadcast, InvalidTransitionError } from "@/lib/telegram-broadcasts/dispatch";

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
        const row = await cancelBroadcast(id);
        return ok({ broadcast: row });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            if (error.from === "unknown") {
                return notFound("Рассылка не найдена");
            }
            return fail(
                "invalid_transition",
                `Нельзя отменить рассылку в состоянии «${error.from}»`,
                { status: 409, details: { from: error.from, action: error.action } }
            );
        }
        console.error("[/api/admin/tg-broadcasts/:id/cancel] failed", error);
        return internal();
    }
}
