/**
 * Aftercare drip orchestration — mirrors `@/lib/booking/reminders` for the
 * 7-step post-appointment sequence.
 *
 * Trigger: an admin marks an `appointment` row `completed`, which calls
 * `completeAppointment()` (see `@/lib/booking/completion`). That function
 * creates an `aftercare_tracking` row and then calls
 * `enqueueAftercareDrip()` here.
 *
 * Two execution paths share the same idempotent core:
 *
 *   1. **BullMQ delayed jobs**   — `apt:aftercare:<id>:<step>` jobs
 *   2. **Vercel cron sweeper**   — `/api/cron/aftercare-drip`, daily.
 *
 * Both call `sendAftercareStepIfDue()` which checks `notification_log`
 * per-channel and dispatches email + Telegram.
 */
import "server-only";

import { and, eq, lte, sql } from "drizzle-orm";

import {
    aftercareGuides,
    aftercareTracking,
    customers,
    db,
    notificationLogs,
    type AftercareTracking,
} from "@/db";
import {
    AFTERCARE_STEPS,
    STEP_OFFSET_DAYS,
    type AftercareStep,
    aftercareStepFireUtc,
} from "@/lib/aftercare/time";
import { delayMsUntil } from "@/lib/booking/time";
import { QUEUE_NAMES, enqueueAftercareStep, type AftercareJob } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { sendAftercareStepEmail } from "@/emails/dispatch";
import { capture } from "@/lib/posthog";
import { getAftercareSettings } from "@/lib/settings";
import { notifyAftercareStep } from "@/lib/telegram/notifications";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface AftercareSendResult {
    trackingId: string;
    step: AftercareStep;
    sent: boolean;
    skippedReason?:
        | "tracking_not_found"
        | "tracking_inactive"
        | "not_due_yet"
        | "already_sent"
        | "no_channels";
    emailSent?: boolean;
    telegramSent?: boolean;
}

export interface AftercareSweepResult {
    candidates: number;
    sent: Record<AftercareStep, number>;
    skipped: number;
    errors: number;
}

function blankSweepResult(): AftercareSweepResult {
    const sent = Object.fromEntries(AFTERCARE_STEPS.map((s) => [s, 0])) as Record<
        AftercareStep,
        number
    >;
    return {
        candidates: 0,
        sent,
        skipped: 0,
        errors: 0,
    };
}

// ---------------------------------------------------------------------------
// Enqueue / cancel
// ---------------------------------------------------------------------------

/**
 * Schedule all seven aftercare steps for a tracking row. Skips steps whose
 * fire time is already in the past (e.g. completing an appointment a week
 * late drops `day1` + `day3` but still schedules `day14` … `day90`) and
 * steps whose offset exceeds the configured `aftercare.max_days` bound.
 *
 * The cron sweeper at `/api/cron/aftercare-drip` covers steps we couldn't
 * enqueue, so BullMQ failures here are non-fatal.
 */
export async function enqueueAftercareDrip(
    tracking: Pick<AftercareTracking, "id" | "appointmentId" | "customerId" | "piercingDate">,
    now: Date = new Date()
): Promise<{ scheduled: AftercareStep[]; skipped: AftercareStep[] }> {
    const scheduled: AftercareStep[] = [];
    const skipped: AftercareStep[] = [];
    const settings = await getAftercareSettings();

    for (const step of AFTERCARE_STEPS) {
        if (STEP_OFFSET_DAYS[step] > settings.maxDays) {
            skipped.push(step);
            continue;
        }
        const fireAt = aftercareStepFireUtc(tracking.piercingDate, step);
        if (!fireAt) {
            skipped.push(step);
            continue;
        }
        const delay = delayMsUntil(fireAt, now);
        if (delay <= 0) {
            skipped.push(step);
            continue;
        }
        try {
            await enqueueAftercareStep(
                {
                    appointmentId: tracking.appointmentId ?? tracking.id,
                    customerId: tracking.customerId,
                    step,
                },
                delay
            );
            scheduled.push(step);
        } catch (err) {
            console.error("[aftercare] enqueue failed", tracking.id, step, err);
            skipped.push(step);
        }
    }
    return { scheduled, skipped };
}

/**
 * Best-effort BullMQ cleanup — used if a tracking row is deactivated.
 * The cron sweeper additionally guards on `is_active`, so this is just an
 * optimization to avoid stale delayed jobs.
 */
export async function cancelAftercareDrip(appointmentIdOrTrackingId: string): Promise<void> {
    for (const step of AFTERCARE_STEPS) {
        const jobId = `aftercare:${appointmentIdOrTrackingId}:${step}`;
        try {
            await redis.del(`bull:${QUEUE_NAMES.aftercareSequence}:${jobId}`);
            await redis.zrem(`bull:${QUEUE_NAMES.aftercareSequence}:delayed`, jobId);
        } catch (err) {
            console.error("[aftercare] cancel job remove failed", jobId, err);
        }
    }
}

// ---------------------------------------------------------------------------
// Send — called by both worker and cron sweeper
// ---------------------------------------------------------------------------

/**
 * Idempotent send. Looks up the tracking row + customer + matching guide,
 * checks `notification_log` per channel, dispatches email + Telegram, and
 * returns the structured outcome.
 */
export async function sendAftercareStepIfDue(
    trackingId: string,
    step: AftercareStep,
    now: Date = new Date()
): Promise<AftercareSendResult> {
    const [tracking] = await db
        .select()
        .from(aftercareTracking)
        .where(eq(aftercareTracking.id, trackingId))
        .limit(1);
    if (!tracking) {
        return { trackingId, step, sent: false, skippedReason: "tracking_not_found" };
    }
    if (tracking.isActive === false) {
        return { trackingId, step, sent: false, skippedReason: "tracking_inactive" };
    }

    const fireAt = aftercareStepFireUtc(tracking.piercingDate, step);
    if (!fireAt || fireAt.getTime() > now.getTime()) {
        return { trackingId, step, sent: false, skippedReason: "not_due_yet" };
    }

    // Per-channel idempotency lookup.
    const sentLogs = await db
        .select({ channel: notificationLogs.channel })
        .from(notificationLogs)
        .where(
            and(
                eq(notificationLogs.type, `aftercare_${step}`),
                eq(notificationLogs.status, "sent"),
                sql`${notificationLogs.metadata} ->> 'trackingId' = ${trackingId}`
            )
        );
    const sentChannels = new Set(sentLogs.map((r) => r.channel));
    if (sentChannels.has("email") && sentChannels.has("telegram")) {
        return { trackingId, step, sent: false, skippedReason: "already_sent" };
    }

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
        return { trackingId, step, sent: false, skippedReason: "no_channels" };
    }

    // Match an aftercare guide for this piercing type (optional — drip still
    // works without one, just no CTA link).
    let guideHandle: string | null = null;
    if (tracking.guideId) {
        const [g] = await db
            .select({ handle: aftercareGuides.handle })
            .from(aftercareGuides)
            .where(eq(aftercareGuides.id, tracking.guideId))
            .limit(1);
        guideHandle = g?.handle ?? null;
    }
    if (!guideHandle) {
        const [g] = await db
            .select({ handle: aftercareGuides.handle })
            .from(aftercareGuides)
            .where(
                and(
                    eq(aftercareGuides.piercingType, tracking.piercingType),
                    eq(aftercareGuides.isPublished, true)
                )
            )
            .limit(1);
        guideHandle = g?.handle ?? null;
    }
    const guideUrl = guideHandle ? `${siteOrigin()}/aftercare/${guideHandle}` : null;

    let emailSent: boolean | undefined;
    let telegramSent: boolean | undefined;

    if (!sentChannels.has("email") && customer.notificationEmail !== false && customer.email) {
        const messageId = await sendAftercareStepEmail({
            to: customer.email,
            customerId: customer.id,
            trackingId,
            appointmentId: tracking.appointmentId ?? null,
            customerFirstName: customer.firstName,
            piercingDate: tracking.piercingDate,
            piercingTypeLabel: tracking.piercingType,
            guideHandle,
            guideUrl,
            step,
        });
        emailSent = messageId !== null;
    }

    if (!sentChannels.has("telegram")) {
        telegramSent = await notifyAftercareStep({
            customerId: customer.id,
            trackingId,
            step,
            piercingDate: tracking.piercingDate,
            piercingTypeLabel: tracking.piercingType,
            guideUrl,
            appointmentId: tracking.appointmentId ?? null,
        });
    }

    if (emailSent || telegramSent) {
        capture({
            event: "aftercare_step_sent",
            distinctId: customer.id,
            properties: {
                tracking_id: trackingId,
                appointment_id: tracking.appointmentId,
                step,
                email_sent: !!emailSent,
                telegram_sent: !!telegramSent,
            },
        });
    }

    const sent = Boolean(emailSent) || Boolean(telegramSent);
    return {
        trackingId,
        step,
        sent,
        skippedReason: sent ? undefined : "no_channels",
        emailSent,
        telegramSent,
    };
}

// ---------------------------------------------------------------------------
// Sweeper — daily cron from Vercel
// ---------------------------------------------------------------------------

export async function sweepDueAftercareSteps(
    now: Date = new Date()
): Promise<AftercareSweepResult> {
    const settings = await getAftercareSettings();
    const result = blankSweepResult();

    for (const step of AFTERCARE_STEPS) {
        if (STEP_OFFSET_DAYS[step] > settings.maxDays) continue;
        // Fire time for piercingDate D = D + offsetDays @ 09:00 МСК = D +
        // (offsetDays * 24h + 6h) in UTC. Subtracting that offset from
        // `now` and slicing to YYYY-MM-DD gives the latest D that *could*
        // have already crossed its fire instant by `now`. We deliberately
        // over-include by one day in edge cases — the precise per-row
        // check in `sendAftercareStepIfDue` (`aftercareStepFireUtc()` vs
        // `now`) is the final gate, this filter just keeps the candidate
        // set small.
        const offsetMs = (STEP_OFFSET_DAYS[step] * 24 + 6) * 60 * 60 * 1000;
        const horizon = new Date(now.getTime() - offsetMs);
        const candidates = await db
            .select({ id: aftercareTracking.id, piercingDate: aftercareTracking.piercingDate })
            .from(aftercareTracking)
            .where(
                and(
                    eq(aftercareTracking.isActive, true),
                    lte(aftercareTracking.piercingDate, toIsoDate(horizon))
                )
            );

        for (const c of candidates) {
            result.candidates += 1;
            try {
                const r = await sendAftercareStepIfDue(c.id, step, now);
                if (r.sent) {
                    result.sent[step] += 1;
                } else if (r.skippedReason === "not_due_yet") {
                    // Date row qualifies but precise fire time hasn't passed yet
                    result.skipped += 1;
                } else {
                    result.skipped += 1;
                }
            } catch (err) {
                console.error("[aftercare.sweep] failed for", c.id, step, err);
                result.errors += 1;
            }
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// Worker entry — kept here so the worker file stays a thin re-export.
// ---------------------------------------------------------------------------
export async function processAftercareStepJob(job: {
    data: AftercareJob & { trackingId?: string };
}): Promise<AftercareSendResult> {
    // BullMQ jobs were enqueued with `appointmentId` (legacy shape). The
    // tracking row is keyed by `appointmentId` 1:1 in this design — resolve
    // it on the way in.
    let trackingId = job.data.trackingId ?? null;
    if (!trackingId) {
        const [row] = await db
            .select({ id: aftercareTracking.id })
            .from(aftercareTracking)
            .where(eq(aftercareTracking.appointmentId, job.data.appointmentId))
            .limit(1);
        trackingId = row?.id ?? null;
    }
    if (!trackingId) {
        return {
            trackingId: job.data.appointmentId,
            step: job.data.step,
            sent: false,
            skippedReason: "tracking_not_found",
        };
    }
    return sendAftercareStepIfDue(trackingId, job.data.step);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toIsoDate(d: Date): string {
    return d.toISOString().slice(0, 10);
}

function siteOrigin(): string {
    const v = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.AUTH_URL;
    return (v ?? "https://piercerkzn.ru").replace(/\/$/u, "");
}
