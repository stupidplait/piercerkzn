/**
 * Vercel Cron entry point — replays the new-arrival fanout for any product
 * published in the last 7 days that still has un-notified recipients.
 *
 * Schedule from `vercel.json`:
 *
 *   { "path": "/api/cron/new-arrival", "schedule": "*\/30 * * * *" }
 *
 * Idempotent: per-recipient `notification_log` rows tagged with
 * `metadata.productId` short-circuit already-sent emails / Telegram pushes
 * inside `fanoutNewArrival()`. A re-tick is therefore safe.
 */
import { internal, ok, unauthorized } from "@/lib/api";
import { isAuthorizedCron } from "@/lib/cron";
import { sweepRecentNewArrivals } from "@/lib/products/new-arrival";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) return unauthorized();
    try {
        const result = await sweepRecentNewArrivals();
        return ok(result);
    } catch (error) {
        console.error("[/api/cron/new-arrival] failed", error);
        return internal();
    }
}
