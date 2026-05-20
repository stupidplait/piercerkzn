/**
 * Booking-reminder orchestration.
 *
 * Two execution paths share the same domain logic:
 *
 *   1. **BullMQ delayed jobs** — `enqueueAppointmentReminders()` schedules
 *      `apt:<id>:24h` and `apt:<id>:2h` with the right delay; the worker
 *      (`src/workers/booking-reminders.ts`) processes them locally.
 *
 *   2. **Vercel cron sweeper** — `/api/cron/booking-reminders` runs every
 *      15 minutes, scans `appointment` for upcoming visits, and fires the
 *      reminders that haven't been sent yet. Required because Vercel does
 *      not support long-running BullMQ workers.
 *
 * Both paths funnel through `sendBookingReminderIfDue()`, which is the
 * single source of truth for:
 *
 *   - Skip terminal / cancelled / no-show / past appointments.
 *   - Per-channel idempotency via `notification_log.metadata.appointmentId`.
 *   - Email + Telegram dispatch, each logged independently.
 *
 * Re-entrant: safe to call from multiple workers (cron + BullMQ) at once
 * because each channel guards itself against double-send via the log.
 */
import "server-only";

import { and, eq, gt, inArray, lte, sql } from "drizzle-orm";
import type { JobsOptions } from "bullmq";

import {
    appointments,
    appointmentServices,
    customers,
    db,
    notificationLogs,
    services as servicesTable,
    settings,
    type Appointment,
} from "@/db";
import { QUEUE_NAMES, enqueueBookingReminder, type BookingReminderJob } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { sendBookingReminderEmail } from "@/emails/dispatch";
import { capture } from "@/lib/posthog";
import { notifyBookingReminder } from "@/lib/telegram/notifications";
import { appointmentStartUtc, delayMsUntil } from "./time";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type ReminderKind = BookingReminderJob["kind"];
export const REMINDER_KINDS: readonly ReminderKind[] = ["24h", "2h"] as const;

const OFFSET_MS: Record<ReminderKind, number> = {
    "24h": 24 * 60 * 60 * 1000,
    "2h": 2 * 60 * 60 * 1000,
};

/** Statuses for which a reminder is still meaningful. */
const REMINDABLE_STATUSES = ["pending", "confirmed"] as const;

export interface ReminderSendResult {
    appointmentId: string;
    kind: ReminderKind;
    /** Sent now, or already sent on a previous tick. */
    sent: boolean;
    skippedReason?:
        | "in_past"
        | "appointment_not_found"
        | "appointment_terminal"
        | "already_sent"
        | "no_email_and_no_telegram";
    emailSent?: boolean;
    telegramSent?: boolean;
}

// ---------------------------------------------------------------------------
// Enqueue / cancel — used by the appointment route handlers
// ---------------------------------------------------------------------------

/**
 * Schedule the 24h + 2h reminders for an appointment. Skips reminders whose
 * trigger time is already in the past (e.g. a same-day booking 90 min before
 * the slot — the 24h reminder is dropped, only 2h is enqueued if still
 * applicable).
 *
 * Idempotent: BullMQ deduplicates by `jobId`, so calling twice is a no-op.
 */
export async function enqueueAppointmentReminders(
    appointment: Pick<Appointment, "id" | "date" | "timeStart">,
    now: Date = new Date()
): Promise<{ scheduled: ReminderKind[]; skipped: ReminderKind[] }> {
    const start = appointmentStartUtc(appointment.date, appointment.timeStart);
    if (!start) {
        console.error(
            "[reminders] could not parse appointment start",
            appointment.id,
            appointment.date,
            appointment.timeStart
        );
        return { scheduled: [], skipped: [...REMINDER_KINDS] };
    }

    const scheduled: ReminderKind[] = [];
    const skipped: ReminderKind[] = [];

    for (const kind of REMINDER_KINDS) {
        const fireAt = new Date(start.getTime() - OFFSET_MS[kind]);
        const delay = delayMsUntil(fireAt, now);
        if (delay <= 0) {
            skipped.push(kind);
            continue;
        }
        try {
            await enqueueBookingReminder(appointment.id, kind, delay);
            scheduled.push(kind);
        } catch (err) {
            // Logged, not thrown — the cron sweeper is the safety net.
            console.error("[reminders] enqueueBookingReminder failed", appointment.id, kind, err);
            skipped.push(kind);
        }
    }
    return { scheduled, skipped };
}

/**
 * Remove any pending BullMQ reminder jobs for the appointment. Called from
 * cancel / reschedule. Failure to remove is non-fatal — the worker checks
 * idempotency + status guards before sending.
 */
export async function cancelAppointmentReminders(appointmentId: string): Promise<void> {
    for (const kind of REMINDER_KINDS) {
        const jobId = `apt:${appointmentId}:${kind}`;
        try {
            // BullMQ stores delayed jobs under a deterministic Redis key;
            // remove both the job key and any pending notification entry.
            await redis.del(`bull:${QUEUE_NAMES.bookingReminder}:${jobId}`);
            await redis.zrem(`bull:${QUEUE_NAMES.bookingReminder}:delayed`, jobId);
        } catch (err) {
            console.error("[reminders] cancel job remove failed", jobId, err);
        }
    }
}

// ---------------------------------------------------------------------------
// Send — called by the worker AND the cron sweeper
// ---------------------------------------------------------------------------

/**
 * Idempotency-aware reminder send. Loads the appointment + customer, checks
 * `notification_log` per channel, dispatches email + Telegram, and returns
 * a structured result so callers can log fan-out stats.
 */
export async function sendBookingReminderIfDue(
    appointmentId: string,
    kind: ReminderKind,
    now: Date = new Date()
): Promise<ReminderSendResult> {
    const [appt] = await db
        .select()
        .from(appointments)
        .where(eq(appointments.id, appointmentId))
        .limit(1);

    if (!appt) {
        return { appointmentId, kind, sent: false, skippedReason: "appointment_not_found" };
    }
    if (
        !REMINDABLE_STATUSES.includes((appt.status ?? "") as (typeof REMINDABLE_STATUSES)[number])
    ) {
        return { appointmentId, kind, sent: false, skippedReason: "appointment_terminal" };
    }

    const start = appointmentStartUtc(appt.date, appt.timeStart);
    if (!start || start.getTime() <= now.getTime()) {
        return { appointmentId, kind, sent: false, skippedReason: "in_past" };
    }

    // Per-channel idempotency: read once, decide per channel.
    const sentLogs = await db
        .select({ channel: notificationLogs.channel })
        .from(notificationLogs)
        .where(
            and(
                eq(notificationLogs.type, `appointment_reminder_${kind}`),
                eq(notificationLogs.status, "sent"),
                sql`${notificationLogs.metadata} ->> 'appointmentId' = ${appointmentId}`
            )
        );
    const sentChannels = new Set(sentLogs.map((r) => r.channel));
    if (sentChannels.has("email") && sentChannels.has("telegram")) {
        return { appointmentId, kind, sent: false, skippedReason: "already_sent" };
    }

    // Customer notification preferences — soft gates.
    const customer = appt.customerId
        ? ((
              await db
                  .select({
                      id: customers.id,
                      email: customers.email,
                      firstName: customers.firstName,
                      notificationEmail: customers.notificationEmail,
                  })
                  .from(customers)
                  .where(eq(customers.id, appt.customerId))
                  .limit(1)
          )[0] ?? null)
        : null;

    const recipientEmail = customer?.email ?? appt.customerEmail;
    const allowEmail = customer?.notificationEmail !== false; // default-true if customer absent

    // Service titles (for the email body + Telegram payload).
    const serviceTitles = await loadServiceTitles(appointmentId);

    let emailSent: boolean | undefined;
    let telegramSent: boolean | undefined;

    if (!sentChannels.has("email") && allowEmail && recipientEmail) {
        const messageId = await sendBookingReminderEmail({
            to: recipientEmail,
            customerId: appt.customerId,
            appointmentId,
            referenceNumber: appt.referenceNumber,
            customerFirstName: customer?.firstName ?? appt.customerFirstName,
            date: appt.date,
            timeStart: appt.timeStart.slice(0, 5),
            timeEnd: appt.timeEnd.slice(0, 5),
            services: serviceTitles,
            studioAddress: await loadStudioAddress(),
            kind,
        });
        emailSent = messageId !== null;
    }

    if (!sentChannels.has("telegram") && appt.customerId) {
        telegramSent = await notifyBookingReminder(appt, kind, { serviceTitles, startUtc: start });
    }

    const anySent = Boolean(emailSent) || Boolean(telegramSent) || sentChannels.size > 0;
    if (!anySent) {
        return {
            appointmentId,
            kind,
            sent: false,
            skippedReason: "no_email_and_no_telegram",
            emailSent,
            telegramSent,
        };
    }

    if (emailSent || telegramSent) {
        capture({
            event: "appointment_reminder_sent",
            distinctId: appt.customerId ?? `appt:${appointmentId}`,
            properties: {
                appointment_id: appointmentId,
                reference_number: appt.referenceNumber,
                kind,
                email_sent: !!emailSent,
                telegram_sent: !!telegramSent,
            },
        });
    }

    return {
        appointmentId,
        kind,
        sent: Boolean(emailSent) || Boolean(telegramSent),
        emailSent,
        telegramSent,
    };
}

// ---------------------------------------------------------------------------
// Sweeper — production source of truth on Vercel
// ---------------------------------------------------------------------------

export interface ReminderSweepResult {
    candidates: number;
    sent24h: number;
    sent2h: number;
    skipped: number;
    errors: number;
}

/**
 * Find all appointments whose 24h or 2h reminder window has been crossed
 * but isn't yet logged, and fire the reminders. Window is everything
 * between `now` and `now + offset` — already-sent reminders short-circuit
 * inside `sendBookingReminderIfDue`.
 */
export async function sweepDueBookingReminders(
    now: Date = new Date()
): Promise<ReminderSweepResult> {
    const result: ReminderSweepResult = {
        candidates: 0,
        sent24h: 0,
        sent2h: 0,
        skipped: 0,
        errors: 0,
    };

    for (const kind of REMINDER_KINDS) {
        const horizon = new Date(now.getTime() + OFFSET_MS[kind]);
        // Pre-filter on `date` to keep the index hit cheap; the precise
        // start-time comparison happens after constructing UTC instants
        // in JS (the `time` column is wall-clock, not timestamptz).
        const dateLo = toIsoDate(now);
        const dateHi = toIsoDate(horizon);

        const candidates = await db
            .select({
                id: appointments.id,
                date: appointments.date,
                timeStart: appointments.timeStart,
                status: appointments.status,
            })
            .from(appointments)
            .where(
                and(
                    inArray(appointments.status, [...REMINDABLE_STATUSES]),
                    lte(appointments.date, dateHi),
                    gt(appointments.date, sqlPriorDate(dateLo))
                )
            );

        for (const c of candidates) {
            const start = appointmentStartUtc(c.date, c.timeStart);
            if (!start) {
                result.errors += 1;
                continue;
            }
            // In the [now, now + offset] window?
            if (start.getTime() < now.getTime()) continue;
            if (start.getTime() > horizon.getTime()) continue;
            result.candidates += 1;

            try {
                const r = await sendBookingReminderIfDue(c.id, kind, now);
                if (r.sent) {
                    if (kind === "24h") result.sent24h += 1;
                    else result.sent2h += 1;
                } else {
                    result.skipped += 1;
                }
            } catch (err) {
                console.error("[reminders.sweep] failed for", c.id, kind, err);
                result.errors += 1;
            }
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// BullMQ worker entry point — re-exported so the worker file stays small.
// ---------------------------------------------------------------------------
export async function processBookingReminderJob(job: {
    data: BookingReminderJob;
    opts?: JobsOptions;
}): Promise<ReminderSendResult> {
    return sendBookingReminderIfDue(job.data.appointmentId, job.data.kind);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadServiceTitles(appointmentId: string): Promise<string[]> {
    const rows = await db
        .select({ name: servicesTable.name })
        .from(appointmentServices)
        .innerJoin(servicesTable, eq(servicesTable.id, appointmentServices.serviceId))
        .where(eq(appointmentServices.appointmentId, appointmentId));
    return rows.map((r) => r.name);
}

async function loadStudioAddress(): Promise<string | undefined> {
    const [row] = await db
        .select({ value: settings.value })
        .from(settings)
        .where(eq(settings.key, "studio.address"))
        .limit(1);
    const v = row?.value as { text?: string } | undefined;
    return typeof v?.text === "string" ? v.text : undefined;
}

function toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/**
 * Returns a SQL fragment for "the day before `iso`" — the `date` column
 * is studio-local but we need to include yesterday in the candidate set
 * to safely cover the timezone offset against UTC `now`.
 */
function sqlPriorDate(iso: string) {
    return sql<string>`(${iso}::date - INTERVAL '1 day')::date::text`;
}
