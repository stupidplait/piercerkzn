/**
 * Vercel Cron entry point — daily heads-up for reservations that will
 * expire in the next 24 hours.
 *
 * Schedule (08:00 UTC ≈ 11:00 МСК):
 *
 *   { "path": "/api/cron/reservation-expiring", "schedule": "0 8 * * *" }
 *
 * Idempotent: per-reservation `notification_log` rows tagged with
 * `metadata.reservationId` short-circuit already-sent pushes inside
 * `sweepExpiringReservations()`. A re-tick is safe.
 */
import { internal, ok, unauthorized } from "@/lib/api";
import { isAuthorizedCron } from "@/lib/cron";
import { sweepExpiringReservations } from "@/lib/reservations/expiring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
    if (!isAuthorizedCron(req)) return unauthorized();
    try {
        const result = await sweepExpiringReservations();
        return ok(result);
    } catch (error) {
        console.error("[/api/cron/reservation-expiring] failed", error);
        return internal();
    }
}
