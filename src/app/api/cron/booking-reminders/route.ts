/**
 * Vercel Cron entry point — fires booking reminders.
 *
 * Schedule from `vercel.json` (every 15 min — same cadence as the
 * reservation-expiry sweeper):
 *
 *   { "path": "/api/cron/booking-reminders", "schedule": "*\/15 * * * *" }
 *
 * Idempotent: each per-channel send is gated by `notification_log` so a
 * delayed cron tick or a retry never produces a duplicate reminder.
 */
import { internal, ok, unauthorized } from "@/lib/api";
import { isAuthorizedCron } from "@/lib/cron";
import { sweepDueBookingReminders } from "@/lib/booking/reminders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) return unauthorized();
    try {
        const result = await sweepDueBookingReminders();
        return ok(result);
    } catch (error) {
        console.error("[/api/cron/booking-reminders] failed", error);
        return internal();
    }
}
