/**
 * Vercel Cron entry point — telegram broadcast sweeper.
 *
 * Schedule from `vercel.json` (every 15 minutes):
 *   { "path": "/api/cron/telegram-broadcast-sweep", "schedule": "*\/15 * * * *" }
 *
 * Two-pass sweep:
 *   1. Promote due `scheduled` broadcasts to `sending`.
 *   2. Recover stuck `sending` broadcasts past `tg.broadcast.stuck_after_ms`
 *      by re-enqueueing recipients without a `notification_log` row keyed
 *      by `metadata->>'telegramId'` (handles unlinked bot users with
 *      `customerId IS NULL`).
 */
import { internal, ok, unauthorized } from "@/lib/api";
import { isAuthorizedCron } from "@/lib/cron";
import { sweepDueBroadcasts } from "@/lib/telegram-broadcasts/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) return unauthorized();
    try {
        const result = await sweepDueBroadcasts();
        return ok(result);
    } catch (error) {
        console.error("[/api/cron/telegram-broadcast-sweep] failed", error);
        return internal();
    }
}
