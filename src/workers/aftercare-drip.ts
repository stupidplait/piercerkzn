/**
 * Aftercare drip worker.
 *
 * In dev (`tsx src/workers/index.ts`) a BullMQ Worker processes
 * `aftercare:<appointmentId>:<step>` jobs as their delay elapses. In
 * production on Vercel the BullMQ worker is not running — the cron route
 * `/api/cron/aftercare-drip` invokes `sweepDueAftercareSteps` once a day
 * instead. Both call into the same idempotent core in
 * `@/lib/aftercare/reminders`.
 */
import "server-only";

import { processAftercareStepJob } from "@/lib/aftercare/reminders";

export { processAftercareStepJob, sweepDueAftercareSteps } from "@/lib/aftercare/reminders";

export const processor = processAftercareStepJob;
