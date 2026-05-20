/**
 * /api/admin/tg-broadcasts/[id]
 *
 *   GET    — fetch a single broadcast or 404.
 *   PATCH  — update a draft broadcast. Returns 409 if not in `draft`.
 *   DELETE — delete a broadcast. Returns 409 if not in `draft` or `cancelled`.
 *
 * State-machine rejections surface as HTTP 409 with body
 * `{ error: { code: "invalid_transition", message, details: { from, action } } }`.
 */
import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import {
    deleteBroadcast,
    getBroadcast,
    InvalidTransitionError,
    updateBroadcast,
} from "@/lib/telegram-broadcasts/dispatch";
import { updateBroadcastSchema } from "@/lib/validations/tg-broadcasts";

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
        const row = await getBroadcast(id);
        if (!row) return notFound("Рассылка не найдена");
        return ok({ broadcast: row });
    } catch (error) {
        console.error("[/api/admin/tg-broadcasts/:id GET] failed", error);
        return internal();
    }
}

export async function PATCH(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;
    const parsed = await parseJson(req, updateBroadcastSchema);
    if (!parsed.ok) return parsed.response!;

    try {
        const row = await updateBroadcast(id, parsed.data!);
        return ok({ broadcast: row });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            if (error.from === "unknown") return notFound("Рассылка не найдена");
            return fail(
                "invalid_transition",
                `Нельзя редактировать рассылку в состоянии «${error.from}»`,
                { status: 409, details: { from: error.from, action: error.action } }
            );
        }
        console.error("[/api/admin/tg-broadcasts/:id PATCH] failed", error);
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
        await deleteBroadcast(id);
        return ok({ deleted: true });
    } catch (error) {
        if (error instanceof InvalidTransitionError) {
            if (error.from === "unknown") return notFound("Рассылка не найдена");
            return fail(
                "invalid_transition",
                `Нельзя удалить рассылку в состоянии «${error.from}»`,
                { status: 409, details: { from: error.from, action: error.action } }
            );
        }
        console.error("[/api/admin/tg-broadcasts/:id DELETE] failed", error);
        return internal();
    }
}
