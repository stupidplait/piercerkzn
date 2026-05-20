/**
 * Satisfaction-survey orchestration — fired once, **7 days after**
 * `appointment.completedAt`. Mirrors `@/lib/aftercare/reminders` and
 * `@/lib/booking/reminders` so the BullMQ + Vercel-cron dual-path stays
 * uniform across the email pipeline.
 *
 * Trigger: an admin marks an `appointment` row `completed`, which calls
 * `completeAppointment()` (see `@/lib/booking/completion`). The route
 * handler then fires `enqueueSatisfactionSurvey()` here as a
 * non-blocking post-tx side-effect.
 *
 * Two execution paths share the same idempotent core:
 *
 *   1. **BullMQ delayed jobs** — `satisfaction:<appointmentId>` job on
 *      `satisfaction:survey` queue.
 *   2. **Vercel cron sweeper** — `/api/cron/satisfaction-survey`, daily.
 *
 * Both call `sendSatisfactionSurveyIfDue()` which re-checks every gate
 * against the live row state and is safe to call any number of times
 * without producing a duplicate `notification_log.status='sent'` row.
 */
import "server-only";

import { and, eq, lte, notExists, sql } from "drizzle-orm";

import { appointments, customers, db, notificationLogs, type Appointment } from "@/db";
import { addDaysIso } from "@/lib/aftercare/time";
import { appointmentStartUtc, delayMsUntil } from "@/lib/booking/time";
import {
    QUEUE_NAMES,
    enqueueSatisfactionSurvey as enqueueSatisfactionSurveyJob,
} from "@/lib/queue";
import { redis } from "@/lib/redis";
import { sendSatisfactionSurveyEmail } from "@/emails/dispatch";
import { capture } from "@/lib/posthog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SatisfactionEnqueueResult {
    scheduled: boolean;
    fireUtc: Date | null;
    reason?: "no_completed_at" | "no_email_optin";
}

export interface SatisfactionSendResult {
    appointmentId: string;
    sent: boolean;
    skippedReason?:
        | "appointment_not_found"
        | "status_not_completed"
        | "no_completed_at"
        | "not_due_yet"
        | "already_sent"
        | "opted_out"
        | "no_email";
}

export interface SatisfactionSweepResult {
    candidates: number;
    sent: number;
    skipped: number;
    errors: number;
}

// Seven days, in milliseconds — used by the cron sweeper's pre-filter on
// `completedAt`. The precise per-row check (`appointmentStartUtc` of
// `completedAt + 7d` at 09:00 МСК) happens inside
// `sendSatisfactionSurveyIfDue()` below.
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Enqueue / cancel
// ---------------------------------------------------------------------------

/**
 * Schedule the satisfaction-survey email for a freshly completed
 * appointment. Computes `fireUtc = appointmentStartUtc(addDaysIso(toIsoDate(
 * completedAt), 7), "09:00")` and enqueues a BullMQ job with the matching
 * delay. The customer notification opt-in gate is **not** checked here —
 * that runs at send time so admins can re-enable email after completion
 * without us silently dropping the survey.
 *
 * Failures from the BullMQ producer are logged but never thrown — the
 * cron sweeper at `/api/cron/satisfaction-survey` is the safety net.
 */
export async function enqueueSatisfactionSurvey(
    appointment: Pick<Appointment, "id" | "date" | "timeStart" | "referenceNumber"> & {
        customerId: string | null;
    },
    completedAt: Date,
    now: Date = new Date()
): Promise<SatisfactionEnqueueResult> {
    if (!completedAt || Number.isNaN(completedAt.getTime())) {
        return { scheduled: false, fireUtc: null, reason: "no_completed_at" };
    }
    if (!appointment.customerId) {
        // No customer record means we can't identify an inbox to mail at
        // send time. We don't pre-check `notificationEmail` here.
        return { scheduled: false, fireUtc: null, reason: "no_email_optin" };
    }

    const fireUtc = appointmentStartUtc(addDaysIso(toIsoDate(completedAt), 7) ?? "", "09:00");
    if (!fireUtc) {
        return { scheduled: false, fireUtc: null, reason: "no_completed_at" };
    }

    const delayMs = delayMsUntil(fireUtc, now);
    try {
        await enqueueSatisfactionSurveyJob(appointment.id, delayMs);
    } catch (err) {
        // BullMQ failures shouldn't block the calling tx — the cron
        // sweeper covers them within 24h.
        console.error("[satisfaction] enqueue failed", appointment.id, err);
    }
    return { scheduled: true, fireUtc };
}

/**
 * Best-effort BullMQ cleanup. Mirrors `cancelAftercareDrip`: deletes the
 * job key and removes it from the delayed set. Failure is non-fatal —
 * `sendSatisfactionSurveyIfDue()` re-checks every gate at send time, so
 * a stale delayed job is harmless.
 */
export async function cancelSatisfactionSurvey(appointmentId: string): Promise<void> {
    const jobId = `satisfaction:${appointmentId}`;
    try {
        await redis.del(`bull:${QUEUE_NAMES.satisfactionSurvey}:${jobId}`);
        await redis.zrem(`bull:${QUEUE_NAMES.satisfactionSurvey}:delayed`, jobId);
    } catch (err) {
        console.error("[satisfaction] cancel job remove failed", jobId, err);
    }
}

// ---------------------------------------------------------------------------
// Send — called by both worker and cron sweeper
// ---------------------------------------------------------------------------

/**
 * Idempotent send. Loads the appointment, walks the gate chain
 * (status → completedAt → due-time → already-sent → opt-in → email)
 * and dispatches the survey email when every gate passes.
 *
 * Gate order matches the design's `Satisfaction survey flow` so that
 * skip reasons are stable for telemetry.
 */
export async function sendSatisfactionSurveyIfDue(
    appointmentId: string,
    now: Date = new Date()
): Promise<SatisfactionSendResult> {
    const [appt] = await db
        .select({
            id: appointments.id,
            customerId: appointments.customerId,
            status: appointments.status,
            completedAt: appointments.completedAt,
            date: appointments.date,
            referenceNumber: appointments.referenceNumber,
        })
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);

    if (!appt) {
        return { appointmentId, sent: false, skippedReason: "appointment_not_found" };
    }
    if (appt.status !== "completed") {
        return { appointmentId, sent: false, skippedReason: "status_not_completed" };
    }
    if (!appt.completedAt) {
        return { appointmentId, sent: false, skippedReason: "no_completed_at" };
    }

    const fireUtc = appointmentStartUtc(addDaysIso(toIsoDate(appt.completedAt), 7) ?? "", "09:00");
    if (!fireUtc || fireUtc.getTime() > now.getTime()) {
        return { appointmentId, sent: false, skippedReason: "not_due_yet" };
    }

    // Idempotency lookup — `dispatch()` writes one row per send attempt,
    // so the presence of `status='sent'` is the authoritative gate.
    const [existingSent] = await db
        .select({ id: notificationLogs.id })
        .from(notificationLogs)
        .where(
            and(
                eq(notificationLogs.type, "satisfaction_survey"),
                eq(notificationLogs.status, "sent"),
                sql`${notificationLogs.metadata} ->> 'appointmentId' = ${appointmentId}`
            )
        )
        .limit(1);
    if (existingSent) {
        return { appointmentId, sent: false, skippedReason: "already_sent" };
    }

    if (!appt.customerId) {
        // No linked customer record — no inbox to honour an opt-in for.
        return { appointmentId, sent: false, skippedReason: "no_email" };
    }

    const [customer] = await db
        .select({
            id: customers.id,
            email: customers.email,
            firstName: customers.firstName,
            notificationEmail: customers.notificationEmail,
        })
        .from(customers)
        .where(eq(customers.id, appt.customerId))
        .limit(1);
    if (!customer) {
        return { appointmentId, sent: false, skippedReason: "no_email" };
    }
    if (customer.notificationEmail === false) {
        return { appointmentId, sent: false, skippedReason: "opted_out" };
    }
    if (!customer.email) {
        return { appointmentId, sent: false, skippedReason: "no_email" };
    }

    const messageId = await sendSatisfactionSurveyEmail({
        to: customer.email,
        customerId: customer.id,
        appointmentId,
        customerFirstName: customer.firstName,
        appointmentDate: appt.date,
        referenceNumber: appt.referenceNumber,
        feedbackUrl: process.env.NEXT_PUBLIC_FEEDBACK_URL ?? null,
        telegramUrl: process.env.NEXT_PUBLIC_TELEGRAM_URL ?? null,
    });
    const sent = messageId !== null;

    if (sent) {
        capture({
            event: "satisfaction_survey_sent",
            distinctId: customer.id,
            properties: {
                appointment_id: appointmentId,
                reference_number: appt.referenceNumber,
            },
        });
    }

    return { appointmentId, sent };
}

// ---------------------------------------------------------------------------
// Sweeper — daily cron from Vercel
// ---------------------------------------------------------------------------

/**
 * Scan every completed appointment whose `completedAt + 7d` window has
 * crossed `now` and which has no prior `status='sent'` survey log row,
 * then invoke the idempotent send for each candidate.
 *
 * The `notExists` correlated subquery keeps the candidate set tight on
 * the SQL side so we don't load already-sent rows into JS only to drop
 * them in the per-row gate.
 */
export async function sweepDueSatisfactionSurveys(
    now: Date = new Date()
): Promise<SatisfactionSweepResult> {
    const result: SatisfactionSweepResult = {
        candidates: 0,
        sent: 0,
        skipped: 0,
        errors: 0,
    };

    const horizon = new Date(now.getTime() - SEVEN_DAYS_MS);

    const candidates = await db
        .select({ id: appointments.id })
        .from(appointments)
        .where(
            and(
                eq(appointments.status, "completed"),
                lte(appointments.completedAt, horizon),
                notExists(
                    db
                        .select({ one: sql`1` })
                        .from(notificationLogs)
                        .where(
                            and(
                                eq(notificationLogs.type, "satisfaction_survey"),
                                eq(notificationLogs.status, "sent"),
                                sql`${notificationLogs.metadata} ->> 'appointmentId' = ${appointments.id}`
                            )
                        )
                )
            )
        );

    for (const c of candidates) {
        result.candidates += 1;
        try {
            const r = await sendSatisfactionSurveyIfDue(c.id, now);
            if (r.sent) {
                result.sent += 1;
            } else {
                result.skipped += 1;
            }
        } catch (err) {
            console.error("[satisfaction.sweep] failed for", c.id, err);
            result.errors += 1;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Worker entry — kept here so the worker file stays a thin re-export.
// ---------------------------------------------------------------------------

export async function processSatisfactionSurveyJob(job: {
    data: { appointmentId: string };
}): Promise<SatisfactionSendResult> {
    return sendSatisfactionSurveyIfDue(job.data.appointmentId, new Date());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `toIsoDate(date)` returns the UTC `YYYY-MM-DD` slice. The studio is
 * fixed at UTC+03:00, so the slice of a `completedAt` `Date` taken in
 * UTC is fine for "+7 days" arithmetic — the +7d shift is the same
 * regardless of which civil day the UTC slice resolves to.
 *
 * Mirrors the local helper in `@/lib/aftercare/reminders` because the
 * canonical helper isn't re-exported from `@/lib/booking/time`.
 */
function toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}
