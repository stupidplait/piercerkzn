/**
 * /api/admin/tg-broadcasts/[id]/send
 *
 *   POST — trigger an immediate Telegram broadcast send. Allowed from
 *   `draft` or `scheduled`.
 *
 * The dispatcher CAS-flips the row into `sending` and then fans out one
 * BullMQ job per recipient. Returns 409 when the broadcast is in any other
 * state (mapped from `InvalidTransitionError`) and 404 when the broadcast
 * does not exist.
 *
 * Mirrors the shape of `app/src/app/api/admin/newsletters/[id]/send/route.ts`.
 *
 * Requirements: 2.6, 3.2, 3.3
 */
import { applyRateLimit, fail, internal, notFound, ok, requireAdmin } from "@/lib/api";
import { InvalidTransitionError, runBroadcast } from "@/lib/telegram-broadcasts/dispatch";

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
        const row = await runBroadcast(id, {
            allowedFromStates: ["draft", "scheduled"],
        });
        return ok({ broadcast: row });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            if (error.from === "unknown") {
                return notFound("Рассылка не найдена");
            }
            return fail(
                "invalid_transition",
                `Нельзя отправить рассылку в состоянии «${error.from}»`,
                {
                    status: 409,
                    details: { from: error.from, action: error.action },
                }
            );
        }
        console.error("[/api/admin/tg-broadcasts/:id/send] failed", error);
        return internal();
    }
}
