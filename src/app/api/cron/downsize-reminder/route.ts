/**
 * Vercel Cron entry point — fires the downsize reminder (Week 6–8 follow-up
 * prompting clients to swap to a shorter post once swelling subsides).
 *
 * Schedule from `vercel.json` (once per day at 07:15 UTC = 10:15 МСК,
 * staggered 15 minutes after the satisfaction survey):
 *
 *   { "path": "/api/cron/downsize-reminder", "schedule": "15 7 * * *" }
 *
 * Idempotent: per-channel sends are gated by `notification_log` rows tagged
 * with `metadata.trackingId + step`, so a delayed tick or a manual rerun
 * never produces a duplicate email or Telegram message.
 */
import { internal, ok, unauthorized } from "@/lib/api";
import { isAuthorizedCron } from "@/lib/cron";
import { sweepDueDownsizeReminders } from "@/lib/downsize/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) return unauthorized();
    try {
        const result = await sweepDueDownsizeReminders();
        return ok(result);
    } catch (error) {
        console.error("[/api/cron/downsize-reminder] failed", error);
        return internal();
    }
}
