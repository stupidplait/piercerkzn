/**
 * Downsize-reminder worker.
 *
 * In dev (`tsx src/workers/index.ts`) a BullMQ Worker processes
 * `downsize:<trackingId>` jobs as their delay elapses. In production on
 * Vercel the BullMQ worker is not running — the cron route
 * `/api/cron/downsize-reminder` invokes `sweepDueDownsizeReminders` once
 * a day instead. Both call into the same idempotent core in
 * `@/lib/downsize/reminders`.
 */
import "server-only";

import { processDownsizeReminderJob } from "@/lib/downsize/reminders";

export { processDownsizeReminderJob, sweepDueDownsizeReminders } from "@/lib/downsize/reminders";

export const processor = processDownsizeReminderJob;
