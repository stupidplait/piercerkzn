/**
 * Satisfaction survey worker.
 *
 * In dev (`tsx src/workers/index.ts`) a BullMQ Worker processes
 * `satisfaction:<appointmentId>` jobs as their delay elapses. In production
 * on Vercel the BullMQ worker is not running — the cron route
 * `/api/cron/satisfaction-survey` invokes `sweepDueSatisfactionSurveys`
 * once a day instead. Both call into the same idempotent core in
 * `@/lib/satisfaction/reminders`.
 */
import "server-only";

import { processSatisfactionSurveyJob } from "@/lib/satisfaction/reminders";

export {
    processSatisfactionSurveyJob,
    sweepDueSatisfactionSurveys,
} from "@/lib/satisfaction/reminders";

export const processor = processSatisfactionSurveyJob;
