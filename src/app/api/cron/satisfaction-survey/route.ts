/**
 * Vercel Cron entry point — fires satisfaction-survey emails for
 * appointments whose `completedAt + 7d` boundary has elapsed.
 *
 * Schedule from `vercel.json` (07:00 UTC = 10:00 МСК):
 *
 *   { "path": "/api/cron/satisfaction-survey", "schedule": "0 7 * * *" }
 *
 * Idempotent: per-appointment sends are gated by `notification_log` rows
 * tagged with `metadata.appointmentId` and `type='satisfaction_survey'`, so
 * a delayed tick or manual rerun never produces a duplicate email.
 */
import { internal, ok, unauthorized } from "@/lib/api";
import { isAuthorizedCron } from "@/lib/cron";
import { sweepDueSatisfactionSurveys } from "@/lib/satisfaction/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) return unauthorized();
    try {
        const result = await sweepDueSatisfactionSurveys(new Date());
        return ok(result);
    } catch (error) {
        console.error("[/api/cron/satisfaction-survey] failed", error);
        return internal();
    }
}
