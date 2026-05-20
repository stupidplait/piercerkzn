/**
 * BullMQ queue *producers* (the publish side).
 *
 * Worker (consumer) processes are NOT started from this file — on Vercel
 * they run as scheduled `/api/cron/*` route handlers (Phase 8); locally
 * they may run as a separate `tsx src/workers/index.ts` process. This
 * module just defines the queues and the typed `enqueue*` helpers that
 * Server Actions / route handlers call.
 *
 * Why BullMQ on a serverless host: it's already in the stack and gives us
 * delayed jobs (`reservation:expire` at +72h) for free. The trade-off is
 * Redis bandwidth; if it becomes a problem we swap individual queues for
 * a `scheduled_jobs` table + cron sweeper without changing call sites.
 */
import "server-only";

import { Queue, type JobsOptions } from "bullmq";
import type { AftercareStep } from "@/lib/aftercare/time";
import { redis } from "./redis";

declare global {
    var __queues: Map<string, Queue> | undefined;
}

const cache = globalThis.__queues ?? new Map<string, Queue>();
if (process.env.NODE_ENV !== "production") {
    globalThis.__queues = cache;
}

function getQueue<T = unknown>(name: string): Queue<T> {
    let q = cache.get(name) as Queue<T> | undefined;
    if (!q) {
        q = new Queue<T>(name, {
            connection: redis,
            defaultJobOptions: {
                removeOnComplete: { age: 3600, count: 1000 }, // 1h / 1k jobs kept
                removeOnFail: { age: 7 * 24 * 3600 }, // 7d for postmortems
                attempts: 3,
                backoff: { type: "exponential", delay: 5_000 },
            },
        });
        cache.set(name, q);
    }
    return q;
}

// ---------------------------------------------------------------------------
// Reservation expiry — fired 72h after creation; flips status -> 'expired'
// and restores inventory.
// ---------------------------------------------------------------------------
export interface ReservationExpiryJob {
    reservationId: string;
}

export function enqueueReservationExpiry(
    reservationId: string,
    delayMs: number,
    opts: JobsOptions = {}
) {
    return getQueue<ReservationExpiryJob>("reservation:expire").add(
        "expire",
        { reservationId },
        { delay: delayMs, jobId: `res:${reservationId}`, ...opts }
    );
}

// ---------------------------------------------------------------------------
// Booking reminders — 24h + 2h before appointment start.
// ---------------------------------------------------------------------------
export interface BookingReminderJob {
    appointmentId: string;
    kind: "24h" | "2h";
}

export function enqueueBookingReminder(
    appointmentId: string,
    kind: BookingReminderJob["kind"],
    delayMs: number
) {
    return getQueue<BookingReminderJob>("booking:reminder").add(
        `remind-${kind}`,
        { appointmentId, kind },
        { delay: delayMs, jobId: `apt:${appointmentId}:${kind}` }
    );
}

// ---------------------------------------------------------------------------
// Aftercare drip — fires at day1, day3, day7, day14, day30, day60, day90 after
// appointment completion (see `lib/aftercare/time.ts` for the canonical
// `AftercareStep` union and offset map).
// ---------------------------------------------------------------------------
export interface AftercareJob {
    appointmentId: string;
    customerId: string;
    step: AftercareStep;
}

export function enqueueAftercareStep(job: AftercareJob, delayMs: number) {
    return getQueue<AftercareJob>("aftercare:sequence").add(`aftercare-${job.step}`, job, {
        delay: delayMs,
        jobId: `aftercare:${job.appointmentId}:${job.step}`,
    });
}

// ---------------------------------------------------------------------------
// New-arrival fanout — when a product is published, notify wishlist + opt-in
// customers via email + Telegram.
// ---------------------------------------------------------------------------
export interface NewArrivalJob {
    productId: string;
}

export function enqueueNewArrival(productId: string, opts: JobsOptions = {}) {
    return getQueue<NewArrivalJob>("notification:new-arrival").add(
        "fanout",
        { productId },
        { jobId: `new-arrival:${productId}`, ...opts }
    );
}

// ---------------------------------------------------------------------------
// Satisfaction survey — fires 7d after `appointment.completedAt` to ask the
// customer how the visit went. One job per completed appointment, gated
// downstream by an idempotent `notification_log` lookup on
// `metadata->>'appointmentId'`.
// ---------------------------------------------------------------------------
export interface SatisfactionSurveyJob {
    appointmentId: string;
}

export function enqueueSatisfactionSurvey(appointmentId: string, delayMs: number) {
    return getQueue<SatisfactionSurveyJob>("satisfaction:survey").add(
        "survey",
        { appointmentId },
        { delay: delayMs, jobId: `satisfaction:${appointmentId}` }
    );
}

// ---------------------------------------------------------------------------
// Downsize reminder — fires 42d after `aftercare_tracking.piercingDate` for
// piercing types in `setting.aftercare.downsize_piercing_types`. One job per
// tracking row; the consumer flips `aftercare_tracking.downsizeReminded` in
// the same tx as the log row to keep the flag and audit trail in lock-step.
// ---------------------------------------------------------------------------
export interface DownsizeReminderJob {
    trackingId: string;
    appointmentId: string | null;
    customerId: string;
}

export function enqueueDownsizeReminder(payload: DownsizeReminderJob, delayMs: number) {
    return getQueue<DownsizeReminderJob>("downsize:reminder").add("remind", payload, {
        delay: delayMs,
        jobId: `downsize:${payload.trackingId}`,
    });
}

// ---------------------------------------------------------------------------
// Newsletter campaign — admin-authored marketing broadcast. One job per
// recipient, deduped at the queue layer via deterministic jobId. The send
// itself is gated by a partial unique index on `notification_log` (see
// `lib/newsletters/dispatch.ts`), so cron + worker can never double-send
// even if BullMQ replays a job past its `removeOnComplete` window.
// ---------------------------------------------------------------------------
export interface NewsletterCampaignJob {
    campaignId: string;
    customerId: string;
}

export function enqueueNewsletterCampaignJob(
    job: NewsletterCampaignJob,
    delayMs = 0,
    opts: JobsOptions = {}
) {
    return getQueue<NewsletterCampaignJob>("newsletter:campaign").add("send", job, {
        delay: delayMs,
        jobId: `nl:${job.campaignId}:${job.customerId}`,
        ...opts,
    });
}

// ---------------------------------------------------------------------------
// Telegram broadcast — admin-authored one-off Russian message blast to all
// opted-in `telegramBotUsers`. One job per recipient, deduped at the queue
// layer via deterministic jobId. The send itself is gated by a partial
// unique index on `notification_log` (see
// `lib/telegram-broadcasts/dispatch.ts`), so cron + worker can never
// double-send even if BullMQ replays a job past its `removeOnComplete`
// window. The dedupe key is `telegramId` (not `customerId`) to handle
// unlinked bot users with `customerId = NULL` correctly.
// ---------------------------------------------------------------------------
export interface TgBroadcastJob {
    broadcastId: string;
    telegramId: number;
    customerId: string | null;
}

export function enqueueTgBroadcastJob(job: TgBroadcastJob, delayMs = 0, opts: JobsOptions = {}) {
    return getQueue<TgBroadcastJob>("telegram:broadcast").add("send", job, {
        delay: delayMs,
        jobId: `tgb:${job.broadcastId}:${job.telegramId}`,
        ...opts,
    });
}

// ---------------------------------------------------------------------------
// Media post-processing — image variants (sharp) + GLB optimisation
// (gltfpack). Triggered from `/api/uploads/finalize` once the object lands
// in R2; the worker reads the source object, writes derivative keys back
// to R2, and (for product images / 3D models) updates the parent record.
// ---------------------------------------------------------------------------
export type MediaProcessKind = "image" | "glb";

export interface MediaProcessJob {
    /** R2 key of the source object (already validated by `/api/uploads/finalize`). */
    key: string;
    kind: MediaProcessKind;
    /** Original `Content-Type` reported by R2 HEAD. */
    contentType: string;
    /** Upload scope (drives derivative naming + which fields to update). */
    scope:
        | "review_image"
        | "portfolio_image"
        | "product_image"
        | "blog_image"
        | "model_3d"
        | "waiver_signature";
    /** Optional parent record id — when present, the worker writes derivative
     *  URLs back to that record (e.g. `product.thumbnailUrl`). */
    parentRecordId?: string;
}

export function enqueueMediaProcess(job: MediaProcessJob, opts: JobsOptions = {}) {
    return getQueue<MediaProcessJob>("media:process").add(`process-${job.kind}`, job, {
        // De-dup on (scope, key) — same upload finalized twice should
        // resolve to a single processing pass.
        jobId: `media:${job.scope}:${job.key}`,
        ...opts,
    });
}

// Names exported for the worker side (Phase 8) so it can subscribe by name
// without re-typing string literals.
export const QUEUE_NAMES = {
    reservationExpire: "reservation:expire",
    bookingReminder: "booking:reminder",
    aftercareSequence: "aftercare:sequence",
    satisfactionSurvey: "satisfaction:survey",
    downsizeReminder: "downsize:reminder",
    newArrival: "notification:new-arrival",
    newsletterCampaign: "newsletter:campaign",
    telegramBroadcast: "telegram:broadcast",
    mediaProcess: "media:process",
} as const;
