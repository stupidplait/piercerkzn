/**
 * /api/admin/tg-broadcasts/[id]/schedule
 *
 *   POST — schedule a draft broadcast for future dispatch.
 *
 * Returns 409 when the broadcast is not in `draft` (mapped from
 * `InvalidTransitionError`).
 *
 * Requirements: 2.6, 3.1, 3.7
 */
import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { InvalidTransitionError, scheduleBroadcast } from "@/lib/telegram-broadcasts/dispatch";
import { scheduleBroadcastSchema } from "@/lib/validations/tg-broadcasts";

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
    const parsed = await parseJson(req, scheduleBroadcastSchema);
    if (!parsed.ok) return parsed.response!;

    try {
        const row = await scheduleBroadcast(id, parsed.data!.scheduledAt);
        return ok({ broadcast: row });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            if (error.from === "unknown") {
                return notFound("Рассылка не найдена");
            }
            return fail(
                "invalid_transition",
                `Нельзя запланировать рассылку в состоянии «${error.from}»`,
                { status: 409, details: { from: error.from, action: error.action } }
            );
        }
        console.error("[/api/admin/tg-broadcasts/:id/schedule] failed", error);
        return internal();
    }
}
