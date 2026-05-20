/**
 * New-arrival fanout worker.
 *
 * In dev (`tsx src/workers/index.ts`) a BullMQ Worker processes
 * `notification:new-arrival` jobs as they're enqueued by the admin
 * "publish product" route. In production on Vercel the BullMQ worker is
 * not running — the cron route `/api/cron/new-arrival` invokes
 * `sweepRecentNewArrivals` every 30 minutes instead. Both paths call into
 * the same idempotent core in `@/lib/products/new-arrival`.
 */
import "server-only";

import { processNewArrivalJob } from "@/lib/products/new-arrival";

export {
    processNewArrivalJob,
    sweepRecentNewArrivals,
    fanoutNewArrival,
} from "@/lib/products/new-arrival";

export const processor = processNewArrivalJob;
