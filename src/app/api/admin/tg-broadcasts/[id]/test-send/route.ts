/**
 * /api/admin/tg-broadcasts/[id]/test-send
 *
 *   POST — render the broadcast and dispatch one copy to the supplied
 *          telegramId.
 *
 * Bypasses the production fanout path entirely: no `notification_log` row
 * is inserted and the broadcast's `recipientCount` / `sentCount` /
 * `failedCount` counters are not touched, nor is the `state` column
 * mutated. Per design §4.1, the `/test-send` route is the only Telegram-
 * touching admin endpoint that must NOT interact with the idempotency
 * contract — it exists for operator-side verification only.
 *
 * Returns 502 when the Telegram API rejects the send (so failures don't
 * masquerade as a server bug); 404 when the broadcast row is missing.
 *
 * Requirements: 2.10
 */
import { applyRateLimit, fail, internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { getBroadcast } from "@/lib/telegram-broadcasts/dispatch";
import { renderBroadcastPayload } from "@/lib/telegram-broadcasts/render";
import { getBot } from "@/lib/telegram/bot";
// Imported directly from the schema module rather than the `@/lib/validations`
// barrel: `testSendSchema` collides with the newsletter equivalent and the
// barrel only re-exports the non-colliding telegram-broadcast schemas (see
// `app/src/lib/validations/index.ts`).
import { testSendSchema } from "@/lib/validations/tg-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const { id } = await ctx.params;
    const parsed = await parseJson(req, testSendSchema);
    if (!parsed.ok) return parsed.response!;

    try {
        const broadcast = await getBroadcast(id);
        if (!broadcast) return notFound("Рассылка не найдена");

        const payload = renderBroadcastPayload(broadcast);
        const bot = getBot();
        const msg = await bot.api.sendMessage(parsed.data!.telegramId, payload.text, {
            parse_mode: payload.parse_mode,
            reply_markup: payload.reply_markup,
        });

        return ok({ ok: true, messageId: msg.message_id });
    } catch (error) {
        console.error("[/api/admin/tg-broadcasts/:id/test-send] failed", error);
        if (error instanceof Error) {
            return fail("test_send_failed", error.message, { status: 502 });
        }
        return internal();
    }
}
