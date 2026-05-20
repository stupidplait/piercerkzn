/**
 * "Reservation about to expire" sweeper.
 *
 * Vercel cron at `/api/cron/reservation-expiring` calls
 * `sweepExpiringReservations()` once per day. We scan reservations whose
 * `expiresAt` falls inside the next 24h and are still `pending` or
 * `confirmed`, then fire the Telegram heads-up.
 *
 * Idempotency: `notifyReservationExpiring()` writes a `notification_log`
 * row tagged with `metadata.reservationId`. The sweeper pre-loads the set
 * of already-notified ids before sending so a re-run is cheap and never
 * sends a second push for the same reservation.
 */
import "server-only";

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db, notificationLogs, reservations, type Reservation } from "@/db";
import { notifyReservationExpiring } from "@/lib/telegram/notifications";

export interface ExpiringSweepResult {
    candidates: number;
    sent: number;
    skipped: number;
    errors: number;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Find pending/confirmed reservations expiring inside the next 24h that
 * have not yet received the heads-up, and dispatch the Telegram push.
 * Pass a custom `windowMs` only in tests.
 */
export async function sweepExpiringReservations(
    now: Date = new Date(),
    windowMs: number = WINDOW_MS
): Promise<ExpiringSweepResult> {
    const horizon = new Date(now.getTime() + windowMs);

    // Stage 1 — candidate set. We deliberately exclude reservations whose
    // customerId is null (no chat to push to) up front.
    const candidates = await db
        .select()
        .from(reservations)
        .where(
            and(
                inArray(reservations.status, ["pending", "confirmed"]),
                gte(reservations.expiresAt, now),
                lte(reservations.expiresAt, horizon),
                sql`${reservations.customerId} is not null`
            )
        );

    const result: ExpiringSweepResult = {
        candidates: candidates.length,
        sent: 0,
        skipped: 0,
        errors: 0,
    };
    if (candidates.length === 0) return result;

    // Stage 2 — load the set of already-notified reservationIds in one
    // query so we don't N+1 the log table.
    const ids = candidates.map((r) => r.id);
    const sentRows = await db
        .select({
            reservationId: sql<string>`(${notificationLogs.metadata} ->> 'reservationId')`,
        })
        .from(notificationLogs)
        .where(
            and(
                eq(notificationLogs.type, "reservation_expiring"),
                eq(notificationLogs.status, "sent"),
                sql`${notificationLogs.metadata} ->> 'reservationId' = any(${ids})`
            )
        );
    const alreadyNotified = new Set(sentRows.map((r) => r.reservationId).filter(Boolean));

    // Stage 3 — dispatch.
    for (const r of candidates) {
        if (alreadyNotified.has(r.id)) {
            result.skipped += 1;
            continue;
        }
        try {
            const ok = await notifyReservationExpiring(r as Reservation);
            if (ok) result.sent += 1;
            else result.skipped += 1;
        } catch (err) {
            console.error("[reservation-expiring] notify failed for", r.id, err);
            result.errors += 1;
        }
    }

    return result;
}
