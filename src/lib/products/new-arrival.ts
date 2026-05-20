/**
 * New-arrival fanout — when a product first crosses `status='published'`
 * we email + Telegram-notify two cohorts:
 *
 *   1. Wishlist — every customer who has the product in their wishlist.
 *   2. Marketing opt-ins — `customer.notification_marketing = true`.
 *
 * Both cohorts dedupe on `customer.id` (wishlist entry wins).
 *
 * Idempotency:
 *   - BullMQ `jobId = new-arrival:<productId>` rejects duplicate jobs.
 *   - Per-recipient `notification_log` rows tagged with
 *     `metadata.productId + audience + channel` make per-channel sends
 *     re-entrant (the cron sweeper or a re-run won't double-send).
 *
 * Two execution paths share `fanoutNewArrival()`:
 *
 *   - **BullMQ delayed job** — `processNewArrivalJob()` (local worker).
 *   - **Vercel cron sweeper** — `/api/cron/new-arrival` retries any product
 *     published within the last 7 days that still has an incomplete fanout.
 *
 * Failures (Resend rate limit, Telegram block, DB hiccups) are logged but
 * never thrown to the queue — the cron will retry the unfinished slice.
 */
import "server-only";

import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";

import { customers, db, notificationLogs, products, productVariants, wishlistItems } from "@/db";
import { sendNewArrivalEmail } from "@/emails/dispatch";
import { capture } from "@/lib/posthog";
import { QUEUE_NAMES, enqueueNewArrival, type NewArrivalJob } from "@/lib/queue";
import { redis } from "@/lib/redis";
import { notifyNewArrival } from "@/lib/telegram/notifications";

import {
    chunk,
    dedupeAudience,
    JEWELRY_TYPE_LABELS_RU,
    MATERIAL_LABELS_RU,
    productUrl,
    type AudienceCandidate,
} from "./new-arrival.utils";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const BATCH_SIZE = 25;
/** Inter-batch delay (ms). Keeps Resend below its default 10 req/s ceiling. */
const BATCH_DELAY_MS = 1500;
/** Lookback window for the cron sweeper (days). */
const SWEEPER_WINDOW_DAYS = 7;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface NewArrivalFanoutResult {
    productId: string;
    audienceCount: number;
    emailsSent: number;
    telegramSent: number;
    skipped: number;
    errors: number;
    /** Set when the orchestrator bailed before iterating. */
    skippedReason?: "product_not_found" | "product_not_published" | "no_audience";
}

export interface NewArrivalSweepResult {
    candidates: number;
    fanouts: number;
    sent: { email: number; telegram: number };
    errors: number;
}

// ---------------------------------------------------------------------------
// Trigger — called from the admin "publish" route
// ---------------------------------------------------------------------------

/**
 * Schedule (or replay) the fanout for a product. Idempotent against
 * BullMQ via the deterministic `jobId`; the per-recipient log gates further.
 */
export async function scheduleNewArrivalFanout(productId: string): Promise<void> {
    try {
        await enqueueNewArrival(productId);
    } catch (err) {
        // Logged, not thrown — the cron sweeper picks it up on the next tick.
        console.error("[new-arrival] enqueue failed", productId, err);
    }
}

// ---------------------------------------------------------------------------
// Fanout — called by the worker AND the cron sweeper
// ---------------------------------------------------------------------------

/**
 * Idempotent fanout for a single product. Loads audience, dedupes, batches,
 * dispatches per-recipient email + Telegram, and updates counters.
 */
export async function fanoutNewArrival(productId: string): Promise<NewArrivalFanoutResult> {
    const result: NewArrivalFanoutResult = {
        productId,
        audienceCount: 0,
        emailsSent: 0,
        telegramSent: 0,
        skipped: 0,
        errors: 0,
    };

    // ---------------------------------------------------------------
    // 1) Resolve product + cheapest variant for the email body.
    // ---------------------------------------------------------------
    const [product] = await db
        .select({
            id: products.id,
            handle: products.handle,
            title: products.title,
            material: products.material,
            jewelryType: products.jewelryType,
            status: products.status,
            publishedAt: products.publishedAt,
            thumbnailUrl: products.thumbnailUrl,
            deletedAt: products.deletedAt,
        })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);

    if (!product || product.deletedAt) {
        result.skippedReason = "product_not_found";
        return result;
    }
    if (product.status !== "published") {
        result.skippedReason = "product_not_published";
        return result;
    }

    const [{ minPrice }] = await db
        .select({
            minPrice: sql<number | null>`min(${productVariants.priceRub})`,
        })
        .from(productVariants)
        .where(and(eq(productVariants.productId, productId), isNull(productVariants.deletedAt)));

    // ---------------------------------------------------------------
    // 2) Resolve audiences (wishlist + marketing opt-ins, deduped).
    // ---------------------------------------------------------------
    const wishlist = await db
        .select({ customerId: wishlistItems.customerId })
        .from(wishlistItems)
        .innerJoin(customers, eq(customers.id, wishlistItems.customerId))
        .where(and(eq(wishlistItems.productId, productId), isNull(customers.deletedAt)));

    const marketing = await db
        .select({ customerId: customers.id })
        .from(customers)
        .where(and(eq(customers.notificationMarketing, true), isNull(customers.deletedAt)));

    const audience = dedupeAudience(wishlist, marketing);
    result.audienceCount = audience.length;
    if (audience.length === 0) {
        result.skippedReason = "no_audience";
        return result;
    }

    // ---------------------------------------------------------------
    // 3) Fetch existing per-recipient logs in one query so we can skip
    //    customers we've already messaged on a given channel.
    // ---------------------------------------------------------------
    const sentLogs = await db
        .select({
            customerId: notificationLogs.customerId,
            channel: notificationLogs.channel,
        })
        .from(notificationLogs)
        .where(
            and(
                eq(notificationLogs.type, "new_arrival"),
                eq(notificationLogs.status, "sent"),
                sql`${notificationLogs.metadata} ->> 'productId' = ${productId}`
            )
        );

    const sentByCustomer = new Map<string, Set<string>>();
    for (const r of sentLogs) {
        if (!r.customerId) continue;
        let set = sentByCustomer.get(r.customerId);
        if (!set) {
            set = new Set<string>();
            sentByCustomer.set(r.customerId, set);
        }
        set.add(r.channel);
    }

    const url = productUrl(siteOrigin(), product.handle);
    const materialLabel = MATERIAL_LABELS_RU[product.material] ?? product.material;
    const jewelryTypeLabel = JEWELRY_TYPE_LABELS_RU[product.jewelryType] ?? product.jewelryType;

    // ---------------------------------------------------------------
    // 4) Iterate in batches, pacing dispatch to respect rate limits.
    // ---------------------------------------------------------------
    const batches = chunk(audience, BATCH_SIZE);
    for (let i = 0; i < batches.length; i++) {
        await Promise.all(
            batches[i].map(async (cand) => {
                try {
                    const outcome = await dispatchToCustomer({
                        cand,
                        product,
                        url,
                        materialLabel,
                        jewelryTypeLabel,
                        fromPriceKopecks: minPrice ?? null,
                        sentChannels: sentByCustomer.get(cand.customerId) ?? new Set(),
                    });
                    if (outcome.emailSent) result.emailsSent += 1;
                    if (outcome.telegramSent) result.telegramSent += 1;
                    if (!outcome.emailSent && !outcome.telegramSent) result.skipped += 1;
                } catch (err) {
                    console.error("[new-arrival] dispatch failed", productId, cand.customerId, err);
                    result.errors += 1;
                }
            })
        );
        if (i < batches.length - 1) {
            await sleep(BATCH_DELAY_MS);
        }
    }

    capture({
        event: "new_arrival_fanout_completed",
        distinctId: "system",
        properties: {
            product_id: productId,
            audience_count: result.audienceCount,
            emails_sent: result.emailsSent,
            telegram_sent: result.telegramSent,
            errors: result.errors,
        },
    });

    return result;
}

interface DispatchInput {
    cand: AudienceCandidate;
    product: {
        id: string;
        handle: string;
        title: string;
        thumbnailUrl: string | null;
    };
    url: string;
    materialLabel: string;
    jewelryTypeLabel: string;
    fromPriceKopecks: number | null;
    sentChannels: Set<string>;
}

interface DispatchOutcome {
    emailSent: boolean;
    telegramSent: boolean;
}

async function dispatchToCustomer(input: DispatchInput): Promise<DispatchOutcome> {
    const { cand, product, url, sentChannels } = input;

    const [customer] = await db
        .select({
            id: customers.id,
            email: customers.email,
            firstName: customers.firstName,
            notificationEmail: customers.notificationEmail,
            notificationMarketing: customers.notificationMarketing,
        })
        .from(customers)
        .where(and(eq(customers.id, cand.customerId), isNull(customers.deletedAt)))
        .limit(1);
    if (!customer) return { emailSent: false, telegramSent: false };

    // For marketing-only candidates, double-check the opt-in flag in case
    // they unsubscribed between audience selection and dispatch.
    if (cand.audience === "marketing" && customer.notificationMarketing !== true) {
        return { emailSent: false, telegramSent: false };
    }

    let emailSent = false;
    if (!sentChannels.has("email") && customer.notificationEmail !== false && customer.email) {
        const messageId = await sendNewArrivalEmail({
            to: customer.email,
            customerId: customer.id,
            productId: product.id,
            audience: cand.audience,
            customerFirstName: customer.firstName,
            productHandle: product.handle,
            productTitle: product.title,
            productMaterialLabel: input.materialLabel,
            productJewelryTypeLabel: input.jewelryTypeLabel,
            fromPriceKopecks: input.fromPriceKopecks,
            thumbnailUrl: product.thumbnailUrl,
            productUrl: url,
        });
        emailSent = messageId !== null;
    }

    let telegramSent = false;
    if (!sentChannels.has("telegram")) {
        telegramSent = await notifyNewArrival({
            customerId: customer.id,
            productId: product.id,
            productTitle: product.title,
            productUrl: url,
            audience: cand.audience,
            fromPriceKopecks: input.fromPriceKopecks,
        });
    }

    return { emailSent, telegramSent };
}

// ---------------------------------------------------------------------------
// Cron sweeper — production safety net
// ---------------------------------------------------------------------------

export async function sweepRecentNewArrivals(
    now: Date = new Date()
): Promise<NewArrivalSweepResult> {
    const result: NewArrivalSweepResult = {
        candidates: 0,
        fanouts: 0,
        sent: { email: 0, telegram: 0 },
        errors: 0,
    };
    const cutoff = new Date(now.getTime() - SWEEPER_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    const candidates = await db
        .select({ id: products.id })
        .from(products)
        .where(
            and(
                eq(products.status, "published"),
                isNotNull(products.publishedAt),
                gt(products.publishedAt, cutoff),
                isNull(products.deletedAt)
            )
        );
    result.candidates = candidates.length;

    for (const c of candidates) {
        try {
            const r = await fanoutNewArrival(c.id);
            if (r.emailsSent > 0 || r.telegramSent > 0) {
                result.fanouts += 1;
                result.sent.email += r.emailsSent;
                result.sent.telegram += r.telegramSent;
            }
            result.errors += r.errors;
        } catch (err) {
            console.error("[new-arrival.sweep] failed for", c.id, err);
            result.errors += 1;
        }
    }
    return result;
}

// ---------------------------------------------------------------------------
// BullMQ worker entry — re-exported by the worker file.
// ---------------------------------------------------------------------------

export async function processNewArrivalJob(job: {
    data: NewArrivalJob;
}): Promise<NewArrivalFanoutResult> {
    return fanoutNewArrival(job.data.productId);
}

// Best-effort BullMQ cleanup. Used if a publish is reversed before the job
// runs (rare). Cron sweep + product status guard make this an optimisation.
export async function cancelNewArrivalJob(productId: string): Promise<void> {
    const jobId = `new-arrival:${productId}`;
    try {
        await redis.del(`bull:${QUEUE_NAMES.newArrival}:${jobId}`);
        await redis.zrem(`bull:${QUEUE_NAMES.newArrival}:delayed`, jobId);
    } catch (err) {
        console.error("[new-arrival] cancel job remove failed", jobId, err);
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sleep(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
}

function siteOrigin(): string {
    const v = process.env.NEXT_PUBLIC_SITE_URL ?? process.env.AUTH_URL;
    return (v ?? "https://piercerkzn.ru").replace(/\/$/u, "");
}
