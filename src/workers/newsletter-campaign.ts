/**
 * Newsletter campaign worker.
 *
 * In dev (`tsx src/workers/index.ts`) a BullMQ Worker processes
 * `nl:<campaignId>:<customerId>` jobs as their chunk-pacing delay elapses.
 * In production on Vercel the BullMQ worker is not running — the cron
 * route `/api/cron/newsletter-sweep` invokes `sweepDueCampaigns` every
 * 15 minutes instead, promoting due `scheduled` campaigns and recovering
 * stuck `sending` ones. Both call into the same idempotent core in
 * `@/lib/newsletters/dispatch`.
 */
import "server-only";

import { processRecipientJob } from "@/lib/newsletters/dispatch";

export { processRecipientJob, sweepDueCampaigns } from "@/lib/newsletters/dispatch";

export const processor = processRecipientJob;
