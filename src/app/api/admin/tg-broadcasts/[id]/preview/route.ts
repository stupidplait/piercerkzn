/**
 * /api/admin/tg-broadcasts/[id]/preview
 *
 *   GET — render the broadcast through `renderBroadcastPayload` and return
 *         `{ text, parse_mode, reply_markup? }` as JSON. No DB writes, no
 *         Telegram API calls. Read-only authoring helper.
 */
import { internal, notFound, ok, requireAdmin } from "@/lib/api";
import { getBroadcast } from "@/lib/telegram-broadcasts/dispatch";
import { renderBroadcastPayload } from "@/lib/telegram-broadcasts/render";

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
        const broadcast = await getBroadcast(id);
        if (!broadcast) return notFound("Рассылка не найдена");

        const payload = renderBroadcastPayload(broadcast);
        return ok(payload);
    } catch (error) {
        console.error("[/api/admin/tg-broadcasts/:id/preview] failed", error);
        return internal();
    }
}
