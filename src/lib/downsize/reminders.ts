/**
 * Downsize-reminder orchestration — mirrors `@/lib/aftercare/reminders` for
 * the single 6-week reminder that prompts the customer to come in for
 * jewelry replacement once swelling has settled.
 *
 * Trigger: an admin marks an `appointment` row `completed`, which calls
 * `completeAppointment()` and (post-tx) `enqueueDownsizeReminder()` here
 * if the resulting `aftercare_tracking` row's `piercingType` is in the
 * configured `setting.aftercare.downsize_piercing_types` list.
 *
 * Two execution paths share the same idempotent core:
 *
 *   1. **BullMQ delayed job**     — `downsize:<trackingId>`
 *   2. **Vercel cron sweeper**    — `/api/cron/downsize-reminder`, daily.
 *
 * Both call `sendDownsizeReminderIfDue()` which gates on the
 * `aftercare_tracking.downsizeReminded` boolean (the authoritative
 * idempotency flag) plus a redundant `notification_log` lookup, and
 * dispatches the email once.
 */
import "server-only";

import { and, eq, inArray, lte, sql } from "drizzle-orm";

import { aftercareTracking, customers, db, notificationLogs, type AftercareTracking } from "@/db";
import { addDaysIso } from "@/lib/aftercare/time";
import { appointmentStartUtc, delayMsUntil } from "@/lib/booking/time";
import { capture } from "@/lib/posthog";
import { QUEUE_NAMES, enqueueDownsizeReminder as enqueueDownsizeReminderJob } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { getAftercareSettings, type AftercareSettings } from "@/lib/settings";
import { sendDownsizeReminderEmail } from "@/emails/dispatch";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
/** Days after `piercingDate` at which the downsize reminder fires. */
export const DOWNSIZE_OFFSET_DAYS = 42;

/** Studio-local fire time (Europe/Moscow, UTC+03:00). */
const FIRE_TIME_LOCAL = "09:00";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type DownsizeEnqueueReason = "type_not_eligible" | "already_past";

export interface DownsizeEnqueueResult {
    scheduled: boolean;
    fireUtc: Date | null;
    reason?: DownsizeEnqueueReason;
}

export type DownsizeSendSkipReason =
    | "tracking_not_found"
    | "tracking_inactive"
    | "already_sent"
    | "not_due_yet"
    | "type_not_eligible"
    | "customer_not_found"
    | "opted_out"
    | "no_email"
    | "dispatch_failed";

export interface DownsizeSendResult {
    trackingId: string;
    sent: boolean;
    skippedReason?: DownsizeSendSkipReason;
}

export interface DownsizeSweepResult {
    candidates: number;
    sent: number;
    skipped: number;
    errors: number;
}

// ---------------------------------------------------------------------------
// Enqueue / cancel
// ---------------------------------------------------------------------------

/**
 * Schedule the single 6-week downsize reminder for a tracking row. Skips
 * the enqueue when the piercing type is not in the configured list and
 * when the fire instant has already passed (the cron sweeper picks up
 * any tracking row whose fire time has elapsed without a corresponding
 * `notification_log` row).
 *
 * BullMQ failures are non-fatal — the cron sweeper at
 * `/api/cron/downsize-reminder` is the durable source of truth; this
 * helper is only an optimization.
 */
export async function enqueueDownsizeReminder(
    tracking: Pick<
        AftercareTracking,
        "id" | "appointmentId" | "customerId" | "piercingDate" | "piercingType"
    >,
    settings?: AftercareSettings,
    now: Date = new Date()
): Promise<DownsizeEnqueueResult> {
    const effectiveSettings = settings ?? (await getAftercareSettings());

    if (!effectiveSettings.downsizePiercingTypes.includes(tracking.piercingType)) {
        return { scheduled: false, fireUtc: null, reason: "type_not_eligible" };
    }

    const target = addDaysIso(tracking.piercingDate, DOWNSIZE_OFFSET_DAYS);
    const fireUtc = target ? appointmentStartUtc(target, FIRE_TIME_LOCAL) : null;
    if (!fireUtc) {
        // Malformed `piercingDate` — should never happen given the schema's
        // `date` column, but treat as past to defer to the sweeper.
        return { scheduled: false, fireUtc: null, reason: "already_past" };
    }

    const delay = delayMsUntil(fireUtc, now);
    if (delay <= 0) {
        // Mirror the aftercare convention: skip past fire times and rely on
        // the cron sweeper to send (or skip permanently if already logged).
        return { scheduled: false, fireUtc, reason: "already_past" };
    }

    try {
        await enqueueDownsizeReminderJob(
            {
                trackingId: tracking.id,
                appointmentId: tracking.appointmentId ?? null,
                customerId: tracking.customerId,
            },
            delay
        );
        return { scheduled: true, fireUtc };
    } catch (err) {
        console.error("[downsize] enqueue failed", tracking.id, err);
        return { scheduled: false, fireUtc };
    }
}

/**
 * Best-effort BullMQ cleanup — used if a tracking row is deactivated or
 * the customer changes their mind. The cron sweeper additionally guards
 * on `is_active` and `downsize_reminded`, so this is just an optimization
 * to avoid stale delayed jobs.
 */
export async function cancelDownsizeReminder(trackingId: string): Promise<void> {
    const jobId = `downsize:${trackingId}`;
    try {
        await redis.del(`bull:${QUEUE_NAMES.downsizeReminder}:${jobId}`);
        await redis.zrem(`bull:${QUEUE_NAMES.downsizeReminder}:delayed`, jobId);
    } catch (err) {
        console.error("[downsize] cancel job remove failed", jobId, err);
    }
}

// ---------------------------------------------------------------------------
// Send — called by both worker and cron sweeper
// ---------------------------------------------------------------------------

/**
 * Idempotent send. Pre-checks every gate (tracking row, due window,
 * eligibility, customer opt-in, prior log row), dispatches the email,
 * and on success flips `aftercare_tracking.downsizeReminded = true`.
 *
 * **Atomicity contract** (per the design):
 *
 *   1. The `downsizeReminded` boolean is the authoritative idempotency
 *      gate; the `notification_log` row is the audit trail.
 *   2. We do NOT wrap `dispatch()` inside a Drizzle transaction because
 *      `dispatch()` writes its own log row in a separate connection.
 *   3. Instead we (a) pre-check `downsizeReminded` AND existing `sent`
 *      log rows outside the tx, (b) call `sendDownsizeReminderEmail`
 *      which inserts the audit row, (c) flip the flag on success.
 *   4. There is a brief window between the log insert and the flag
 *      flip; the next sweeper tick covers that case via the
 *      `notification_log` lookup, so a flag-flip failure cannot cause a
 *      duplicate send.
 */
export async function sendDownsizeReminderIfDue(
    trackingId: string,
    now: Date = new Date()
): Promise<DownsizeSendResult> {
    // ---- Load tracking row ----
    const [tracking] = await db
        .select()
        .from(aftercareTracking)
        .where(eq(aftercareTracking.id, trackingId))
        .limit(1);
    if (!tracking) {
        return { trackingId, sent: false, skippedReason: "tracking_not_found" };
    }
    if (tracking.isActive === false) {
        return { trackingId, sent: false, skippedReason: "tracking_inactive" };
    }
    if (tracking.downsizeReminded === true) {
        return { trackingId, sent: false, skippedReason: "already_sent" };
    }

    // ---- Time gate ----
    const target = addDaysIso(tracking.piercingDate, DOWNSIZE_OFFSET_DAYS);
    const fireUtc = target ? appointmentStartUtc(target, FIRE_TIME_LOCAL) : null;
    if (!fireUtc || fireUtc.getTime() > now.getTime()) {
        return { trackingId, sent: false, skippedReason: "not_due_yet" };
    }

    // ---- Type-eligibility gate ----
    const settings = await getAftercareSettings();
    if (!settings.downsizePiercingTypes.includes(tracking.piercingType)) {
        return { trackingId, sent: false, skippedReason: "type_not_eligible" };
    }

    // ---- Customer + opt-in gate ----
    const [customer] = await db
        .select({
            id: customers.id,
            email: customers.email,
            firstName: customers.firstName,
            notificationEmail: customers.notificationEmail,
        })
        .from(customers)
        .where(eq(customers.id, tracking.customerId))
        .limit(1);
    if (!customer) {
        return { trackingId, sent: false, skippedReason: "customer_not_found" };
    }
    if (customer.notificationEmail === false) {
        // Do NOT flip the flag — the customer may opt back in later and we
        // still want to deliver the (now-overdue) reminder.
        return { trackingId, sent: false, skippedReason: "opted_out" };
    }
    if (!customer.email) {
        return { trackingId, sent: false, skippedReason: "no_email" };
    }

    // ---- Redundant audit-trail gate (covers the rare flag-flip failure) ----
    const [existing] = await db
        .select({ id: notificationLogs.id })
        .from(notificationLogs)
        .where(
            and(
                eq(notificationLogs.type, "downsize_reminder"),
                eq(notificationLogs.status, "sent"),
                sql`${notificationLogs.metadata} ->> 'trackingId' = ${trackingId}`
            )
        )
        .limit(1);
    if (existing) {
        // A previous send dispatched but the flag flip failed. Self-heal.
        try {
            await db
                .update(aftercareTracking)
                .set({ downsizeReminded: true })
                .where(eq(aftercareTracking.id, trackingId));
        } catch (err) {
            console.error("[downsize] self-heal flag flip failed", trackingId, err);
        }
        return { trackingId, sent: false, skippedReason: "already_sent" };
    }

    // ---- Dispatch ----
    const messageId = await sendDownsizeReminderEmail({
        to: customer.email,
        customerId: customer.id,
        trackingId,
        appointmentId: tracking.appointmentId ?? null,
        customerFirstName: customer.firstName,
        piercingDate: tracking.piercingDate,
        piercingTypeLabel: tracking.piercingType,
        bookingUrl: process.env.NEXT_PUBLIC_BOOKING_URL ?? null,
        telegramUrl: process.env.NEXT_PUBLIC_TELEGRAM_URL ?? null,
    });

    if (messageId === null) {
        // `dispatch()` already inserted a `status='failed'` log row. The
        // sweeper's `status='sent'` gate is unaffected, so the next tick
        // will retry.
        return { trackingId, sent: false, skippedReason: "dispatch_failed" };
    }

    // ---- Flag flip ----
    try {
        await db
            .update(aftercareTracking)
            .set({ downsizeReminded: true })
            .where(eq(aftercareTracking.id, trackingId));
    } catch (err) {
        // The audit row already exists (`status='sent'`), so the sweeper's
        // self-heal branch above will flip the flag on the next tick. Log
        // and continue — we do not want to surface a 5xx for this.
        console.error("[downsize] flag flip failed (audit row exists)", trackingId, err);
    }

    capture({
        event: "downsize_reminder_sent",
        distinctId: customer.id,
        properties: {
            tracking_id: trackingId,
            appointment_id: tracking.appointmentId,
            piercing_type: tracking.piercingType,
        },
    });

    return { trackingId, sent: true };
}

// ---------------------------------------------------------------------------
// Sweeper — daily cron from Vercel
// ---------------------------------------------------------------------------

export async function sweepDueDownsizeReminders(
    now: Date = new Date()
): Promise<DownsizeSweepResult> {
    const settings = await getAftercareSettings();
    const result: DownsizeSweepResult = {
        candidates: 0,
        sent: 0,
        skipped: 0,
        errors: 0,
    };

    if (settings.downsizePiercingTypes.length === 0) {
        return result;
    }

    // Earliest `piercingDate` whose +42d fire window could have passed by
    // `now`. We over-include by one day to catch edge cases at midnight
    // boundaries — `sendDownsizeReminderIfDue` re-checks the precise fire
    // instant before dispatching.
    const horizon = new Date(now.getTime() - DOWNSIZE_OFFSET_DAYS * 24 * 60 * 60 * 1000);
    const horizonIso = toIsoDate(horizon);

    const candidates = await db
        .select({ id: aftercareTracking.id })
        .from(aftercareTracking)
        .where(
            and(
                eq(aftercareTracking.isActive, true),
                eq(aftercareTracking.downsizeReminded, false),
                inArray(aftercareTracking.piercingType, settings.downsizePiercingTypes),
                lte(aftercareTracking.piercingDate, horizonIso)
            )
        );

    for (const c of candidates) {
        result.candidates += 1;
        try {
            const r = await sendDownsizeReminderIfDue(c.id, now);
            if (r.sent) {
                result.sent += 1;
            } else {
                result.skipped += 1;
            }
        } catch (err) {
            console.error("[downsize.sweep] failed for", c.id, err);
            result.errors += 1;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Worker entry — kept here so the worker file stays a thin re-export.
// ---------------------------------------------------------------------------
export async function processDownsizeReminderJob(job: {
    data: { trackingId: string };
}): Promise<DownsizeSendResult> {
    return sendDownsizeReminderIfDue(job.data.trackingId, new Date());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}
