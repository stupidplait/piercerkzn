/**
 * Local BullMQ worker entry point.
 *
 *   pnpm exec tsx src/workers/index.ts
 *
 * Connects to local Redis (Docker Compose) and processes:
 *
 *   - `reservation:expire`  — flips pending reservations past expires_at.
 *   - `booking:reminder`    — fires the 24h / 2h appointment reminders.
 *
 * In production we use the Vercel Cron sweepers instead — see
 * `src/app/api/cron/reservation-expiry/route.ts` and
 * `src/app/api/cron/booking-reminders/route.ts`.
 */
import { Worker } from "bullmq";

import { redis } from "@/lib/redis";
import { QUEUE_NAMES } from "@/lib/queue";
import { processReservationExpiryJob } from "./reservation-expiry";
import { processBookingReminderJob } from "./booking-reminders";
import { processAftercareStepJob } from "./aftercare-drip";
import { processSatisfactionSurveyJob } from "./satisfaction-survey";
import { processDownsizeReminderJob } from "./downsize-reminder";
import { processNewArrivalJob } from "./new-arrival";
import { processRecipientJob as processNewsletterRecipientJob } from "./newsletter-campaign";
import { processRecipientJob as processTgBroadcastRecipientJob } from "./telegram-broadcast";
import { processMediaJob } from "./media-process";

console.log("[workers] starting…");

const expiryWorker = new Worker(QUEUE_NAMES.reservationExpire, processReservationExpiryJob, {
    connection: redis,
    concurrency: 4,
});
expiryWorker.on("completed", (job) => {
    console.log(`[reservation:expire] ${job.id} -> done`);
});
expiryWorker.on("failed", (job, err) => {
    console.error(`[reservation:expire] ${job?.id} failed:`, err);
});

const reminderWorker = new Worker(QUEUE_NAMES.bookingReminder, processBookingReminderJob, {
    connection: redis,
    concurrency: 4,
});
reminderWorker.on("completed", (job) => {
    console.log(`[booking:reminder] ${job.id} -> done`);
});
reminderWorker.on("failed", (job, err) => {
    console.error(`[booking:reminder] ${job?.id} failed:`, err);
});

const aftercareWorker = new Worker(QUEUE_NAMES.aftercareSequence, processAftercareStepJob, {
    connection: redis,
    concurrency: 4,
});
aftercareWorker.on("completed", (job) => {
    console.log(`[aftercare:sequence] ${job.id} -> done`);
});
aftercareWorker.on("failed", (job, err) => {
    console.error(`[aftercare:sequence] ${job?.id} failed:`, err);
});

const satisfactionWorker = new Worker(
    QUEUE_NAMES.satisfactionSurvey,
    processSatisfactionSurveyJob,
    {
        connection: redis,
        concurrency: 2,
    }
);
satisfactionWorker.on("completed", (job) => {
    console.log(`[satisfaction:survey] ${job.id} -> done`);
});
satisfactionWorker.on("failed", (job, err) => {
    console.error(`[satisfaction:survey] ${job?.id} failed:`, err);
});

const downsizeWorker = new Worker(QUEUE_NAMES.downsizeReminder, processDownsizeReminderJob, {
    connection: redis,
    concurrency: 2,
});
downsizeWorker.on("completed", (job) => {
    console.log(`[downsize:reminder] ${job.id} -> done`);
});
downsizeWorker.on("failed", (job, err) => {
    console.error(`[downsize:reminder] ${job?.id} failed:`, err);
});

const newArrivalWorker = new Worker(QUEUE_NAMES.newArrival, processNewArrivalJob, {
    connection: redis,
    // Single-tracked — fanout already batches and paces internally.
    concurrency: 1,
});
newArrivalWorker.on("completed", (job) => {
    console.log(`[notification:new-arrival] ${job.id} -> done`);
});
newArrivalWorker.on("failed", (job, err) => {
    console.error(`[notification:new-arrival] ${job?.id} failed:`, err);
});

const newsletterCampaignWorker = new Worker(
    QUEUE_NAMES.newsletterCampaign,
    (job) => processNewsletterRecipientJob(job.data),
    {
        connection: redis,
        concurrency: 4,
    }
);
newsletterCampaignWorker.on("completed", (job) => {
    console.log(`[newsletter:campaign] ${job.id} -> done`);
});
newsletterCampaignWorker.on("failed", (job, err) => {
    console.error(`[newsletter:campaign] ${job?.id} failed:`, err);
});

const telegramBroadcastWorker = new Worker(
    QUEUE_NAMES.telegramBroadcast,
    (job) => processTgBroadcastRecipientJob(job.data),
    {
        connection: redis,
        concurrency: 4,
    }
);
telegramBroadcastWorker.on("completed", (job) => {
    console.log(`[telegram:broadcast] ${job.id} -> done`);
});
telegramBroadcastWorker.on("failed", (job, err) => {
    console.error(`[telegram:broadcast] ${job?.id} failed:`, err);
});

const mediaWorker = new Worker(QUEUE_NAMES.mediaProcess, processMediaJob, {
    connection: redis,
    concurrency: 2,
});
mediaWorker.on("completed", (job) => {
    console.log(`[media:process] ${job.id} -> done`);
});
mediaWorker.on("failed", (job, err) => {
    console.error(`[media:process] ${job?.id} failed:`, err);
});

async function shutdown(signal: string) {
    console.log(`[workers] received ${signal}, draining…`);
    await Promise.all([
        expiryWorker.close(),
        reminderWorker.close(),
        aftercareWorker.close(),
        satisfactionWorker.close(),
        downsizeWorker.close(),
        newArrivalWorker.close(),
        newsletterCampaignWorker.close(),
        telegramBroadcastWorker.close(),
        mediaWorker.close(),
    ]);
    await redis.quit();
    process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
