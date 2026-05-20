/**
 * Newsletter campaign orchestration core.
 *
 * Owns CRUD, lifecycle, audience snapshot, fanout, per-recipient consumer,
 * and the cron sweeper for admin-authored marketing broadcasts. Mirrors the
 * dual-path producer + sweeper shape of `lib/products/new-arrival.ts` and
 * the per-recipient send shape of `lib/aftercare/reminders.ts`.
 *
 * Idempotency contract:
 *   - State transitions use single-row CAS via
 *     `UPDATE … WHERE id=$ AND state=$expected RETURNING *`. Row-miss is
 *     mapped to `InvalidTransitionError` and surfaced to admin routes as 409.
 *   - Per-recipient sends rely on a partial unique index on `notification_log`
 *     (claimed inside `sendNewsletterCampaignEmail`). The BullMQ jobId
 *     `nl:<campaignId>:<customerId>` is a queue-layer dedupe atop the SQL one.
 *   - The completion check (`sentCount + failedCount === recipientCount`)
 *     is run inside a single CAS so the very last finalisation flips
 *     `sending → sent` exactly once.
 */
import "server-only";

import { and, asc, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";

import {
    customers,
    db,
    newsletterCampaigns,
    notificationLogs,
    type NewsletterCampaign,
} from "@/db";
import { sendNewsletterCampaignEmail } from "@/emails/dispatch";
import { capture } from "@/lib/posthog";
import { enqueueNewsletterCampaignJob, type NewsletterCampaignJob } from "@/lib/queue";
import { getNewsletterSettings } from "@/lib/settings";

import { selectMarketingAudience } from "./audience";
import { transition, type CampaignAction, type CampaignState } from "./state";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Raised when a state transition is rejected — either by the in-process
 * `transition()` table or by a single-row CAS that found the row in a
 * different state. Admin routes map this to HTTP 409 with body
 * `{ error: "invalid_transition", from, action }`.
 */
export class InvalidTransitionError extends Error {
    constructor(
        public readonly from: CampaignState | "unknown",
        public readonly action: CampaignAction
    ) {
        super(`invalid_transition: ${from} -/-> ${action}`);
        this.name = "InvalidTransitionError";
    }
}

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export type ProcessRecipientResult =
    | { status: "sent"; messageId?: string }
    | { status: "skipped"; reason: SkipReason }
    | { status: "failed"; error: string };

export type SkipReason =
    | "campaign_missing"
    | "campaign_state"
    | "customer_missing"
    | "customer_deleted"
    | "customer_opted_out"
    | "customer_no_email"
    | "already_sent";

export interface SweepResult {
    promoted: number;
    recovered: number;
    recoveredJobs: number;
    errors: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Split `arr` into contiguous chunks of at most `size` items. */
export function chunk<T>(arr: T[], size: number): T[][] {
    if (size <= 0) return [arr];
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        out.push(arr.slice(i, i + size));
    }
    return out;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateCampaignInput {
    subject: string;
    preheader?: string | null;
    bodyMarkdown: string;
    createdByUserId?: string | null;
}

export async function createCampaign(input: CreateCampaignInput): Promise<NewsletterCampaign> {
    const [row] = await db
        .insert(newsletterCampaigns)
        .values({
            subject: input.subject,
            preheader: input.preheader ?? null,
            bodyMarkdown: input.bodyMarkdown,
            state: "draft",
            recipientCount: 0,
            sentCount: 0,
            failedCount: 0,
            createdByUserId: input.createdByUserId ?? null,
        })
        .returning();
    return row;
}

export interface ListCampaignsInput {
    limit?: number;
    offset?: number;
    state?: CampaignState;
}

export interface ListCampaignsResult {
    rows: NewsletterCampaign[];
    total: number;
}

export async function listCampaigns(input: ListCampaignsInput = {}): Promise<ListCampaignsResult> {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const offset = Math.max(0, input.offset ?? 0);

    const filter = input.state ? eq(newsletterCampaigns.state, input.state) : sql`true`;

    const rows = await db
        .select()
        .from(newsletterCampaigns)
        .where(filter)
        .orderBy(desc(newsletterCampaigns.createdAt))
        .limit(limit)
        .offset(offset);

    const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(newsletterCampaigns)
        .where(filter);

    return { rows, total };
}

export async function getCampaign(id: string): Promise<NewsletterCampaign | null> {
    const [row] = await db
        .select()
        .from(newsletterCampaigns)
        .where(eq(newsletterCampaigns.id, id))
        .limit(1);
    return row ?? null;
}

export interface UpdateCampaignPatch {
    subject?: string;
    preheader?: string | null;
    bodyMarkdown?: string;
}

/**
 * Patch a draft campaign. Loads the row first to disambiguate "missing" from
 * "wrong state", then runs a single-row CAS so concurrent edits race on the
 * row rather than on the read.
 */
export async function updateCampaign(
    id: string,
    patch: UpdateCampaignPatch
): Promise<NewsletterCampaign> {
    const current = await getCampaign(id);
    if (!current) {
        throw new InvalidTransitionError("unknown", "patch");
    }

    // In-process gate (defense-in-depth alongside SQL CAS).
    const t = transition(current.state as CampaignState, "patch");
    if (!t.ok) {
        throw new InvalidTransitionError(current.state as CampaignState, "patch");
    }

    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.subject !== undefined) setClause.subject = patch.subject;
    if (patch.preheader !== undefined) setClause.preheader = patch.preheader;
    if (patch.bodyMarkdown !== undefined) setClause.bodyMarkdown = patch.bodyMarkdown;

    const [updated] = await db
        .update(newsletterCampaigns)
        .set(setClause)
        .where(and(eq(newsletterCampaigns.id, id), eq(newsletterCampaigns.state, "draft")))
        .returning();

    if (!updated) {
        // CAS lost — re-load to surface the actual current state in the error.
        const after = await getCampaign(id);
        throw new InvalidTransitionError(
            (after?.state as CampaignState | undefined) ?? "unknown",
            "patch"
        );
    }
    return updated;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function scheduleCampaign(id: string, scheduledAt: Date): Promise<NewsletterCampaign> {
    const settings = await getNewsletterSettings();
    if (!settings.fromAddress) {
        throw new Error("from_address_unset");
    }

    const [updated] = await db
        .update(newsletterCampaigns)
        .set({
            state: "scheduled",
            scheduledAt,
            updatedAt: new Date(),
        })
        .where(and(eq(newsletterCampaigns.id, id), eq(newsletterCampaigns.state, "draft")))
        .returning();

    if (!updated) {
        const after = await getCampaign(id);
        throw new InvalidTransitionError(
            (after?.state as CampaignState | undefined) ?? "unknown",
            "schedule"
        );
    }
    return updated;
}

export interface RunCampaignOptions {
    now?: Date;
    /** Defaults to ['draft', 'scheduled']. The cron sweeper passes ['scheduled']. */
    allowedFromStates?: CampaignState[];
}

/**
 * CAS into `sending`, then call `fanoutNewsletter`. Used both by the manual
 * "send now" admin route and by the cron sweeper (with
 * `allowedFromStates: ['scheduled']`).
 */
export async function runCampaign(
    id: string,
    options: RunCampaignOptions = {}
): Promise<NewsletterCampaign> {
    const now = options.now ?? new Date();
    const allowed = options.allowedFromStates ?? ["draft", "scheduled"];

    const settings = await getNewsletterSettings();
    if (!settings.fromAddress) {
        throw new Error("from_address_unset");
    }

    const [updated] = await db
        .update(newsletterCampaigns)
        .set({
            state: "sending",
            startedAt: now,
            updatedAt: now,
        })
        .where(and(eq(newsletterCampaigns.id, id), inArray(newsletterCampaigns.state, allowed)))
        .returning();

    if (!updated) {
        const after = await getCampaign(id);
        throw new InvalidTransitionError(
            (after?.state as CampaignState | undefined) ?? "unknown",
            "send"
        );
    }

    await fanoutNewsletter(id, now);
    return updated;
}

export interface CancelCampaignOptions {
    now?: Date;
}

export async function cancelCampaign(
    id: string,
    options: CancelCampaignOptions = {}
): Promise<NewsletterCampaign> {
    const now = options.now ?? new Date();
    const [updated] = await db
        .update(newsletterCampaigns)
        .set({
            state: "cancelled",
            cancelledAt: now,
            updatedAt: now,
        })
        .where(
            and(
                eq(newsletterCampaigns.id, id),
                inArray(newsletterCampaigns.state, ["draft", "scheduled", "sending"])
            )
        )
        .returning();

    if (!updated) {
        const after = await getCampaign(id);
        throw new InvalidTransitionError(
            (after?.state as CampaignState | undefined) ?? "unknown",
            "cancel"
        );
    }
    return updated;
}

export async function deleteCampaign(id: string): Promise<void> {
    const deleted = await db
        .delete(newsletterCampaigns)
        .where(
            and(
                eq(newsletterCampaigns.id, id),
                inArray(newsletterCampaigns.state, ["draft", "cancelled"])
            )
        )
        .returning({ id: newsletterCampaigns.id });

    if (deleted.length === 0) {
        const after = await getCampaign(id);
        throw new InvalidTransitionError(
            (after?.state as CampaignState | undefined) ?? "unknown",
            "delete"
        );
    }
}

// ---------------------------------------------------------------------------
// Fanout — the per-campaign body
// ---------------------------------------------------------------------------

/**
 * Snapshot the marketing audience, write `recipientCount`, and enqueue one
 * BullMQ job per recipient with chunk-paced delays. If the audience is empty,
 * CAS straight to `sent` with all counters zero per Requirement 4.4.
 *
 * Re-entrant: the BullMQ jobId is `nl:<campaignId>:<customerId>` so a second
 * call on the same campaign after a sweeper recovery doesn't double-enqueue.
 */
export async function fanoutNewsletter(id: string, now: Date = new Date()): Promise<void> {
    const settings = await getNewsletterSettings();
    const audience = await selectMarketingAudience();

    if (audience.length === 0) {
        // Empty audience — CAS straight to `sent` (Requirement 4.4).
        await db
            .update(newsletterCampaigns)
            .set({
                state: "sent",
                completedAt: now,
                recipientCount: 0,
                sentCount: 0,
                failedCount: 0,
                updatedAt: now,
            })
            .where(and(eq(newsletterCampaigns.id, id), eq(newsletterCampaigns.state, "sending")));

        capture({
            event: "newsletter_campaign_completed",
            distinctId: "system",
            properties: {
                campaign_id: id,
                recipient_count: 0,
                sent_count: 0,
                failed_count: 0,
                empty_audience: true,
            },
        });
        return;
    }

    // Persist the recipient count snapshot — the completion check uses it.
    await db
        .update(newsletterCampaigns)
        .set({ recipientCount: audience.length, updatedAt: now })
        .where(eq(newsletterCampaigns.id, id));

    const chunks = chunk(audience, settings.chunkSize);
    for (let i = 0; i < chunks.length; i++) {
        const delay = i * settings.chunkDelayMs;
        for (const member of chunks[i]) {
            try {
                await enqueueNewsletterCampaignJob(
                    {
                        campaignId: id,
                        customerId: member.id,
                    } satisfies NewsletterCampaignJob,
                    delay
                );
            } catch (err) {
                // Log but never throw — the sweeper recovers any unenqueued
                // recipients on its next tick.
                console.error("[newsletter] enqueue failed", id, member.id, err);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Per-recipient consumer
// ---------------------------------------------------------------------------

/**
 * Consume one recipient job. Loads the campaign + customer, gates on
 * lifecycle and opt-in flags, and delegates to `sendNewsletterCampaignEmail`
 * for the INSERT-claim + Resend round-trip. Updates campaign counters on the
 * outcome and runs the completion check.
 *
 * Returns a structured result for telemetry; never throws on dispatch errors
 * (the failure is accounted via `failedCount`).
 */
export async function processRecipientJob(
    job: NewsletterCampaignJob
): Promise<ProcessRecipientResult> {
    const { campaignId, customerId } = job;

    // 1. Load the campaign and gate on state.
    const campaign = await getCampaign(campaignId);
    if (!campaign) {
        return { status: "skipped", reason: "campaign_missing" };
    }
    if (campaign.state !== "sending") {
        return { status: "skipped", reason: "campaign_state" };
    }

    // 2. Load the customer and gate on opt-in / soft-delete / email present.
    const [customer] = await db
        .select({
            id: customers.id,
            email: customers.email,
            firstName: customers.firstName,
            deletedAt: customers.deletedAt,
            notificationMarketing: customers.notificationMarketing,
        })
        .from(customers)
        .where(eq(customers.id, customerId))
        .limit(1);

    if (!customer) {
        return { status: "skipped", reason: "customer_missing" };
    }
    if (customer.deletedAt) {
        return { status: "skipped", reason: "customer_deleted" };
    }
    if (customer.notificationMarketing !== true) {
        return { status: "skipped", reason: "customer_opted_out" };
    }
    if (!customer.email) {
        return { status: "skipped", reason: "customer_no_email" };
    }

    // 3. Dispatch — INSERT-claim semantics live inside the helper.
    const dispatchResult = await sendNewsletterCampaignEmail({
        to: customer.email,
        customerId: customer.id,
        campaignId,
        customerFirstName: customer.firstName,
        subject: campaign.subject,
        preheader: campaign.preheader,
        bodyMarkdown: campaign.bodyMarkdown,
    });

    if (dispatchResult.skipped === "already_sent") {
        // The unique index rejected the claim — another worker (or a prior
        // sweeper run) already accounted for this recipient. Don't touch the
        // counters and don't re-run the completion check (the count from the
        // campaign already reflects this recipient via the prior worker).
        return { status: "skipped", reason: "already_sent" };
    }

    if (dispatchResult.sent) {
        await db
            .update(newsletterCampaigns)
            .set({
                sentCount: sql`${newsletterCampaigns.sentCount} + 1`,
                updatedAt: new Date(),
            })
            .where(eq(newsletterCampaigns.id, campaignId));

        capture({
            event: "newsletter_campaign_sent",
            distinctId: customer.id,
            properties: {
                campaign_id: campaignId,
                customer_id: customer.id,
                message_id: dispatchResult.messageId ?? null,
            },
        });

        await maybeFinaliseCampaign(campaignId);
        return { status: "sent", messageId: dispatchResult.messageId };
    }

    // Dispatch failed.
    const errorMsg = dispatchResult.failed ?? "unknown";
    await db
        .update(newsletterCampaigns)
        .set({
            failedCount: sql`${newsletterCampaigns.failedCount} + 1`,
            updatedAt: new Date(),
        })
        .where(eq(newsletterCampaigns.id, campaignId));

    await maybeFinaliseCampaign(campaignId);
    return { status: "failed", error: errorMsg };
}

/**
 * Atomic completion check: when `sentCount + failedCount === recipientCount`,
 * CAS state from `sending` to `sent`. The single SQL statement makes this
 * safe under concurrent finalisations — the very last recipient flips the
 * state exactly once (or zero times if it was already flipped).
 */
async function maybeFinaliseCampaign(campaignId: string): Promise<void> {
    const now = new Date();
    const [flipped] = await db
        .update(newsletterCampaigns)
        .set({ state: "sent", completedAt: now, updatedAt: now })
        .where(
            and(
                eq(newsletterCampaigns.id, campaignId),
                eq(newsletterCampaigns.state, "sending"),
                sql`${newsletterCampaigns.sentCount} + ${newsletterCampaigns.failedCount} = ${newsletterCampaigns.recipientCount}`
            )
        )
        .returning({
            id: newsletterCampaigns.id,
            recipientCount: newsletterCampaigns.recipientCount,
            sentCount: newsletterCampaigns.sentCount,
            failedCount: newsletterCampaigns.failedCount,
        });

    if (flipped) {
        capture({
            event: "newsletter_campaign_completed",
            distinctId: "system",
            properties: {
                campaign_id: flipped.id,
                recipient_count: flipped.recipientCount,
                sent_count: flipped.sentCount,
                failed_count: flipped.failedCount,
                empty_audience: false,
            },
        });
    }
}

// ---------------------------------------------------------------------------
// Cron sweeper
// ---------------------------------------------------------------------------

/**
 * Two-pass sweeper:
 *
 *   A. Promote: campaigns whose `scheduledAt <= now` go from `scheduled` to
 *      `sending` via `runCampaign(id, { allowedFromStates: ['scheduled'] })`.
 *      Concurrent ticks race on the CAS — the loser sees `InvalidTransitionError`
 *      and is silently swallowed.
 *
 *   B. Recovery: campaigns stuck in `sending` for longer than
 *      `settings.stuckAfterMs` re-snapshot the audience, subtract recipients
 *      with any `notification_log` row for the campaign (sent | failed |
 *      pending — Requirement 5.4 prohibits retries against any prior log
 *      row), re-enqueue the remainder with chunk pacing, and bump `startedAt`.
 */
export async function sweepDueCampaigns(now: Date = new Date()): Promise<SweepResult> {
    const result: SweepResult = {
        promoted: 0,
        recovered: 0,
        recoveredJobs: 0,
        errors: 0,
    };

    // -----------------------------------------------------------------
    // Pass A — Promote due `scheduled` campaigns.
    // -----------------------------------------------------------------
    const due = await db
        .select({ id: newsletterCampaigns.id })
        .from(newsletterCampaigns)
        .where(
            and(
                eq(newsletterCampaigns.state, "scheduled"),
                lte(newsletterCampaigns.scheduledAt, now)
            )
        )
        .orderBy(asc(newsletterCampaigns.scheduledAt));

    for (const c of due) {
        try {
            await runCampaign(c.id, {
                now,
                allowedFromStates: ["scheduled"],
            });
            result.promoted += 1;
        } catch (err) {
            if (err instanceof InvalidTransitionError) {
                // Another tick beat us to it — silently skip.
                continue;
            }
            console.error("[newsletter.sweep] promote failed", c.id, err);
            result.errors += 1;
        }
    }

    // -----------------------------------------------------------------
    // Pass B — Recover stuck `sending` campaigns.
    // -----------------------------------------------------------------
    const settings = await getNewsletterSettings();
    const stuckCutoff = new Date(now.getTime() - settings.stuckAfterMs);

    const stuck = await db
        .select({
            id: newsletterCampaigns.id,
            startedAt: newsletterCampaigns.startedAt,
        })
        .from(newsletterCampaigns)
        .where(
            and(
                eq(newsletterCampaigns.state, "sending"),
                lt(newsletterCampaigns.startedAt, stuckCutoff)
            )
        );

    for (const c of stuck) {
        try {
            const audience = await selectMarketingAudience();

            // Recipients already represented in `notification_log` (any
            // status — Requirement 5.4 forbids retrying any prior row).
            const logged = await db
                .select({ customerId: notificationLogs.customerId })
                .from(notificationLogs)
                .where(
                    and(
                        eq(notificationLogs.type, "newsletter_campaign"),
                        sql`${notificationLogs.metadata} ->> 'campaignId' = ${c.id}`
                    )
                );
            const loggedSet = new Set(
                logged.map((r) => r.customerId).filter((x): x is string => typeof x === "string")
            );

            const pending = audience.filter((m) => !loggedSet.has(m.id));

            if (pending.length > 0) {
                const chunks = chunk(pending, settings.chunkSize);
                for (let i = 0; i < chunks.length; i++) {
                    const delay = i * settings.chunkDelayMs;
                    for (const member of chunks[i]) {
                        try {
                            await enqueueNewsletterCampaignJob(
                                {
                                    campaignId: c.id,
                                    customerId: member.id,
                                },
                                delay
                            );
                            result.recoveredJobs += 1;
                        } catch (err) {
                            console.error(
                                "[newsletter.sweep] re-enqueue failed",
                                c.id,
                                member.id,
                                err
                            );
                            result.errors += 1;
                        }
                    }
                }
            }

            // Bump `startedAt` so the recovery quiesces if the queue is
            // healthy on the next tick.
            await db
                .update(newsletterCampaigns)
                .set({ startedAt: now, updatedAt: now })
                .where(eq(newsletterCampaigns.id, c.id));

            result.recovered += 1;
        } catch (err) {
            console.error("[newsletter.sweep] recover failed", c.id, err);
            result.errors += 1;
        }
    }

    return result;
}
