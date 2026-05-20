/**
 * Vercel Cron entry point — fires the aftercare drip (Day 1 / Week 1 /
 * Week 2 / Month 1).
 *
 * Schedule from `vercel.json` (once per day at 06:00 UTC = 09:00 МСК):
 *
 *   { "path": "/api/cron/aftercare-drip", "schedule": "0 6 * * *" }
 *
 * Idempotent: per-channel sends are gated by `notification_log` rows tagged
 * with `metadata.trackingId + step`, so a delayed tick or a manual rerun
 * never produces a duplicate email or Telegram message.
 */
import { internal, ok, unauthorized } from "@/lib/api";
import { isAuthorizedCron } from "@/lib/cron";
import { sweepDueAftercareSteps } from "@/lib/aftercare/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) return unauthorized();
    try {
        const result = await sweepDueAftercareSteps();
        return ok(result);
    } catch (error) {
        console.error("[/api/cron/aftercare-drip] failed", error);
        return internal();
    }
}
