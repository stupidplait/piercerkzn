/**
 * Vercel Cron entry point — newsletter campaign sweeper.
 *
 * Schedule from `vercel.json` (every 15 minutes):
 *   { "path": "/api/cron/newsletter-sweep", "schedule": "*\/15 * * * *" }
 *
 * Two-pass sweep:
 *   1. Promote due `scheduled` campaigns to `sending`.
 *   2. Recover stuck `sending` campaigns past `settings.stuckAfterMs` by
 *      re-enqueueing recipients that have no `notification_log` row yet.
 *
 * Both passes are idempotent under the partial unique index on
 * `notification_log` and the per-row state CAS.
 */
import { internal, ok, unauthorized } from "@/lib/api";
import { isAuthorizedCron } from "@/lib/cron";
import { sweepDueCampaigns } from "@/lib/newsletters/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) return unauthorized();
    try {
        const result = await sweepDueCampaigns();
        return ok(result);
    } catch (error) {
        console.error("[/api/cron/newsletter-sweep] failed", error);
        return internal();
    }
}
