/**
 * Vercel Cron entry point — sweeps expired reservations.
 *
 * Schedule it from `vercel.json`:
 *   { "crons": [ { "path": "/api/cron/reservation-expiry", "schedule": "*\/15 * * * *" } ] }
 *
 * Authorization: `Bearer ${CRON_SECRET}` header (Vercel sets it
 * automatically when `CRON_SECRET` is configured in project env).
 */
import { internal, ok, unauthorized } from "@/lib/api";
import { isAuthorizedCron } from "@/lib/cron";
import { sweepExpiredReservations } from "@/workers/reservation-expiry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) return unauthorized();
    try {
        const result = await sweepExpiredReservations();
        return ok(result);
    } catch (error) {
        console.error("[/api/cron/reservation-expiry] failed", error);
        return internal();
    }
}
