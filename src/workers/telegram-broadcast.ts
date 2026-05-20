/**
 * Telegram broadcast worker.
 *
 * In dev (`tsx src/workers/index.ts`) a BullMQ Worker processes
 * `tgb:<broadcastId>:<telegramId>` jobs as their chunk-pacing delay
 * elapses. In production on Vercel the BullMQ worker is not running —
 * the cron route `/api/cron/telegram-broadcast-sweep` invokes
 * `sweepDueBroadcasts` every 15 minutes instead, promoting due
 * `scheduled` broadcasts and recovering stuck `sending` ones. Both
 * call into the same idempotent core in
 * `@/lib/telegram-broadcasts/dispatch`.
 */
import "server-only";

import { processRecipientJob } from "@/lib/telegram-broadcasts/dispatch";

export { processRecipientJob, sweepDueBroadcasts } from "@/lib/telegram-broadcasts/dispatch";

export const processor = processRecipientJob;
