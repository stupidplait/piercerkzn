/**
 * POST /api/tg — Telegram webhook.
 *
 * Telegram POSTs every update here. We verify the request via the
 * `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_BOT_WEBHOOK_SECRET`
 * before letting grammY process it.
 *
 * Webhook setup (run once after deploy):
 *   curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
 *        -d "url=https://piercerkzn.ru/api/tg" \
 *        -d "secret_token=<TELEGRAM_BOT_WEBHOOK_SECRET>"
 */
import { fail, internal, ok, unauthorized } from "@/lib/api";
import { ensureBotInitialised } from "@/lib/telegram/bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
    const secret = process.env.TELEGRAM_BOT_WEBHOOK_SECRET;
    if (!secret) {
        return fail("misconfigured", "TELEGRAM_BOT_WEBHOOK_SECRET is not set", { status: 500 });
    }
    const provided = req.headers.get("x-telegram-bot-api-secret-token");
    if (provided !== secret) return unauthorized();

    let update: unknown;
    try {
        update = await req.json();
    } catch {
        return fail("bad_request", "Invalid JSON", { status: 400 });
    }

    try {
        const bot = await ensureBotInitialised();
        // grammY expects an Update object; type cast is intentional —
        // Telegram is the source of truth for the shape.
        await bot.handleUpdate(update as Parameters<typeof bot.handleUpdate>[0]);
        return ok({ ok: true });
    } catch (error) {
        console.error("[/api/tg] webhook failed", error);
        return internal();
    }
}

export async function GET() {
    // Health check — useful when manually verifying the endpoint is up.
    return ok({ service: "tg-webhook", ok: true });
}
