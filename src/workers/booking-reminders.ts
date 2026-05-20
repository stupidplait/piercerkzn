/**
 * Booking-reminder worker.
 *
 * In dev (`tsx src/workers/index.ts`) a BullMQ Worker keeps a connection
 * open and processes `apt:<id>:24h` / `apt:<id>:2h` jobs as their delays
 * elapse. In production on Vercel the Worker doesn't run; the cron route
 * `/api/cron/booking-reminders` invokes `sweepDueBookingReminders` every
 * 15 minutes instead. Both call into the same idempotent core in
 * `@/lib/booking/reminders`.
 */
import "server-only";

import { processBookingReminderJob } from "@/lib/booking/reminders";

export { processBookingReminderJob, sweepDueBookingReminders } from "@/lib/booking/reminders";

// Re-exported under the worker-process namespace so `workers/index.ts`
// gets a single import point for each queue.
export const processor = processBookingReminderJob;
