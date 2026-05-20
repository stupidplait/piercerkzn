/**
 * Reservation expiry worker.
 *
 * Two execution modes share the same domain logic:
 *
 *   1. **Local / standalone (BullMQ Worker)** — `tsx src/workers/index.ts`
 *      keeps a BullMQ Worker alive listening on the `reservation:expire`
 *      queue. Useful in dev with `docker compose up -d`.
 *
 *   2. **Production (Vercel Cron)** — `/api/cron/reservation-expiry`
 *      sweeps the database for any pending reservation past `expires_at`
 *      and runs the expiry transaction. Vercel does not support
 *      long-running workers; the cron route is the source of truth.
 *
 * Both modes call `expireReservation()` from `@/lib/reservations` which is
 * idempotent — safe to invoke from both modes simultaneously.
 */
import "server-only";

import { and, eq, lte } from "drizzle-orm";

import { db, reservations } from "@/db";
import { capture } from "@/lib/posthog";
import { expireReservation } from "@/lib/reservations";

export interface ExpirySweepResult {
    candidates: number;
    expired: number;
    errors: number;
}

/**
 * Find all `pending` reservations whose `expires_at` is in the past and run
 * the expiry transaction on each. Used by the cron route.
 */
export async function sweepExpiredReservations(now = new Date()): Promise<ExpirySweepResult> {
    const candidates = await db
        .select({ id: reservations.id, ref: reservations.referenceNumber })
        .from(reservations)
        .where(and(eq(reservations.status, "pending"), lte(reservations.expiresAt, now)));

    let expired = 0;
    let errors = 0;
    for (const c of candidates) {
        try {
            const updated = await expireReservation(c.id);
            if (updated?.status === "expired") {
                expired += 1;
                capture({
                    event: "reservation_expired",
                    distinctId: `system`,
                    properties: { reservation_id: c.id, reference_number: c.ref },
                });
            }
        } catch (err) {
            errors += 1;
            console.error("[expirySweep] failed for", c.id, err);
        }
    }
    return { candidates: candidates.length, expired, errors };
}

/**
 * Single-job processor used by the BullMQ Worker (mode 1).
 */
export async function processReservationExpiryJob(job: { data: { reservationId: string } }) {
    const updated = await expireReservation(job.data.reservationId);
    if (updated?.status === "expired") {
        capture({
            event: "reservation_expired",
            distinctId: "system",
            properties: {
                reservation_id: updated.id,
                reference_number: updated.referenceNumber,
            },
        });
    }
    return updated?.status ?? "no_op";
}
