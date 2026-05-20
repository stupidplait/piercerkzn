/**
 * Telegram broadcast orchestration core.
 *
 * Owns CRUD, lifecycle, audience snapshot, fanout, per-recipient consumer,
 * and the cron sweeper for admin-authored Telegram broadcasts. Mirrors the
 * dual-path producer + sweeper shape of `lib/newsletters/dispatch.ts` —
 * only the audience predicate, the dedupe key (`telegramId`), and the
 * send target (`bot.api.sendMessage`) differ.
 *
 * Idempotency contract:
 *   - State transitions use single-row CAS via
 *     `UPDATE … WHERE id=$ AND state=$expected RETURNING *`. Row-miss is
 *     mapped to `InvalidTransitionError` and surfaced to admin routes as 409.
 *   - Per-recipient sends rely on a partial unique index on `notification_log`
 *     keyed by `(type, broadcastId, telegramId)` (claimed inside
 *     `sendBroadcastToRecipient`). The BullMQ jobId
 *     `tgb:<broadcastId>:<telegramId>` is a queue-layer dedupe atop the
 *     SQL one.
 *   - The completion check (`sentCount + failedCount === recipientCount`)
 *     is run inside a single CAS so the very last finalisation flips
 *     `sending → sent` exactly once.
 */
import "server-only";

import { and, asc, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";

import { db, notificationLogs, telegramBroadcasts, type TelegramBroadcast } from "@/db";
import { enqueueTgBroadcastJob, type TgBroadcastJob } from "@/lib/queue";
import { getTelegramBroadcastSettings } from "@/lib/settings";

import { selectBroadcastAudience } from "./audience";
import { sendBroadcastToRecipient, type SendBroadcastResult } from "./send";
import { transition, type BroadcastAction, type BroadcastState } from "./state";

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
        public readonly from: BroadcastState | "unknown",
        public readonly action: BroadcastAction
    ) {
        super(`invalid_transition: ${from} -/-> ${action}`);
        this.name = "InvalidTransitionError";
    }
}

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export type ProcessRecipientResult =
    | { status: "sent"; messageId?: number }
    | { status: "skipped"; reason: SkipReason }
    | { status: "failed"; error: string };

export type SkipReason = "broadcast_missing" | "broadcast_state" | "already_sent";

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

export interface CreateBroadcastInput {
    title: string;
    bodyText: string;
    parseMode?: "HTML" | "MarkdownV2";
    inlineButtonLabel?: string | null;
    inlineButtonUrl?: string | null;
    createdByUserId?: string | null;
}

export async function createBroadcast(input: CreateBroadcastInput): Promise<TelegramBroadcast> {
    const [row] = await db
        .insert(telegramBroadcasts)
        .values({
            title: input.title,
            bodyText: input.bodyText,
            parseMode: input.parseMode ?? "HTML",
            inlineButtonLabel: input.inlineButtonLabel ?? null,
            inlineButtonUrl: input.inlineButtonUrl ?? null,
            state: "draft",
            recipientCount: 0,
            sentCount: 0,
            failedCount: 0,
            createdByUserId: input.createdByUserId ?? null,
        })
        .returning();
    return row;
}

export interface ListBroadcastsInput {
    limit?: number;
    offset?: number;
    state?: BroadcastState;
}

export interface ListBroadcastsResult {
    rows: TelegramBroadcast[];
    total: number;
}

export async function listBroadcasts(
    input: ListBroadcastsInput = {}
): Promise<ListBroadcastsResult> {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const offset = Math.max(0, input.offset ?? 0);

    const filter = input.state ? eq(telegramBroadcasts.state, input.state) : sql`true`;

    const rows = await db
        .select()
        .from(telegramBroadcasts)
        .where(filter)
        .orderBy(desc(telegramBroadcasts.createdAt))
        .limit(limit)
        .offset(offset);

    const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(telegramBroadcasts)
        .where(filter);

    return { rows, total };
}

export async function getBroadcast(id: string): Promise<TelegramBroadcast | null> {
    const [row] = await db
        .select()
        .from(telegramBroadcasts)
        .where(eq(telegramBroadcasts.id, id))
        .limit(1);
    return row ?? null;
}

export interface UpdateBroadcastPatch {
    title?: string;
    bodyText?: string;
    parseMode?: "HTML" | "MarkdownV2";
    inlineButtonLabel?: string | null;
    inlineButtonUrl?: string | null;
}

/**
 * Patch a draft broadcast. Loads the row first to disambiguate "missing"
 * from "wrong state", then runs a single-row CAS so concurrent edits race
 * on the row rather than on the read.
 */
export async function updateBroadcast(
    id: string,
    patch: UpdateBroadcastPatch
): Promise<TelegramBroadcast> {
    const current = await getBroadcast(id);
    if (!current) {
        throw new InvalidTransitionError("unknown", "patch");
    }

    // In-process gate (defense-in-depth alongside SQL CAS).
    const t = transition(current.state as BroadcastState, "patch");
    if (!t.ok) {
        throw new InvalidTransitionError(current.state as BroadcastState, "patch");
    }

    const setClause: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title !== undefined) setClause.title = patch.title;
    if (patch.bodyText !== undefined) setClause.bodyText = patch.bodyText;
    if (patch.parseMode !== undefined) setClause.parseMode = patch.parseMode;
    if (patch.inlineButtonLabel !== undefined) {
        setClause.inlineButtonLabel = patch.inlineButtonLabel;
    }
    if (patch.inlineButtonUrl !== undefined) {
        setClause.inlineButtonUrl = patch.inlineButtonUrl;
    }

    const [updated] = await db
        .update(telegramBroadcasts)
        .set(setClause)
        .where(and(eq(telegramBroadcasts.id, id), eq(telegramBroadcasts.state, "draft")))
        .returning();

    if (!updated) {
        // CAS lost — re-load to surface the actual current state in the error.
        const after = await getBroadcast(id);
        throw new InvalidTransitionError(
            (after?.state as BroadcastState | undefined) ?? "unknown",
            "patch"
        );
    }
    return updated;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function scheduleBroadcast(id: string, scheduledAt: Date): Promise<TelegramBroadcast> {
    const [updated] = await db
        .update(telegramBroadcasts)
        .set({
            state: "scheduled",
            scheduledAt,
            updatedAt: new Date(),
        })
        .where(and(eq(telegramBroadcasts.id, id), eq(telegramBroadcasts.state, "draft")))
        .returning();

    if (!updated) {
        const after = await getBroadcast(id);
        throw new InvalidTransitionError(
            (after?.state as BroadcastState | undefined) ?? "unknown",
            "schedule"
        );
    }
    return updated;
}

export interface RunBroadcastOptions {
    now?: Date;
    /** Defaults to ['draft', 'scheduled']. The cron sweeper passes ['scheduled']. */
    allowedFromStates?: BroadcastState[];
}

/**
 * CAS into `sending`, then call `fanoutBroadcast`. Used both by the manual
 * "send now" admin route and by the cron sweeper (with
 * `allowedFromStates: ['scheduled']`).
 */
export async function runBroadcast(
    id: string,
    options: RunBroadcastOptions = {}
): Promise<TelegramBroadcast> {
    const now = options.now ?? new Date();
    const allowed = options.allowedFromStates ?? ["draft", "scheduled"];

    const [updated] = await db
        .update(telegramBroadcasts)
        .set({
            state: "sending",
            startedAt: now,
            updatedAt: now,
        })
        .where(and(eq(telegramBroadcasts.id, id), inArray(telegramBroadcasts.state, allowed)))
        .returning();

    if (!updated) {
        const after = await getBroadcast(id);
        throw new InvalidTransitionError(
            (after?.state as BroadcastState | undefined) ?? "unknown",
            "send"
        );
    }

    await fanoutBroadcast(id, now);
    return updated;
}

export interface CancelBroadcastOptions {
    now?: Date;
}

export async function cancelBroadcast(
    id: string,
    options: CancelBroadcastOptions = {}
): Promise<TelegramBroadcast> {
    const now = options.now ?? new Date();
    const [updated] = await db
        .update(telegramBroadcasts)
        .set({
            state: "cancelled",
            cancelledAt: now,
            updatedAt: now,
        })
        .where(
            and(
                eq(telegramBroadcasts.id, id),
                inArray(telegramBroadcasts.state, ["draft", "scheduled", "sending"])
            )
        )
        .returning();

    if (!updated) {
        const after = await getBroadcast(id);
        throw new InvalidTransitionError(
            (after?.state as BroadcastState | undefined) ?? "unknown",
            "cancel"
        );
    }
    return updated;
}

export async function deleteBroadcast(id: string): Promise<void> {
    const deleted = await db
        .delete(telegramBroadcasts)
        .where(
            and(
                eq(telegramBroadcasts.id, id),
                inArray(telegramBroadcasts.state, ["draft", "cancelled"])
            )
        )
        .returning({ id: telegramBroadcasts.id });

    if (deleted.length === 0) {
        const after = await getBroadcast(id);
        throw new InvalidTransitionError(
            (after?.state as BroadcastState | undefined) ?? "unknown",
            "delete"
        );
    }
}

// ---------------------------------------------------------------------------
// Fanout — the per-broadcast body
// ---------------------------------------------------------------------------

/**
 * Snapshot the broadcast audience, write `recipientCount`, and enqueue one
 * BullMQ job per recipient with chunk-paced delays. If the audience is
 * empty, CAS straight to `sent` with all counters zero.
 *
 * Re-entrant: the BullMQ jobId is `tgb:<broadcastId>:<telegramId>` so a
 * second call on the same broadcast after a sweeper recovery doesn't
 * double-enqueue.
 */
export async function fanoutBroadcast(id: string, now: Date = new Date()): Promise<void> {
    const settings = await getTelegramBroadcastSettings();
    const audience = await selectBroadcastAudience();

    if (audience.length === 0) {
        // Empty audience — CAS straight to `sent`.
        await db
            .update(telegramBroadcasts)
            .set({
                state: "sent",
                completedAt: now,
                recipientCount: 0,
                sentCount: 0,
                failedCount: 0,
                updatedAt: now,
            })
            .where(and(eq(telegramBroadcasts.id, id), eq(telegramBroadcasts.state, "sending")));
        return;
    }

    // Persist the recipient count snapshot — the completion check uses it.
    await db
        .update(telegramBroadcasts)
        .set({ recipientCount: audience.length, updatedAt: now })
        .where(eq(telegramBroadcasts.id, id));

    const chunks = chunk(audience, settings.chunkSize);
    for (let i = 0; i < chunks.length; i++) {
        const delay = i * settings.chunkDelayMs;
        for (const member of chunks[i]) {
            try {
                await enqueueTgBroadcastJob(
                    {
                        broadcastId: id,
                        telegramId: member.telegramId,
                        customerId: member.customerId,
                    } satisfies TgBroadcastJob,
                    delay
                );
            } catch (err) {
                // Log but never throw — the sweeper recovers any
                // unenqueued recipients on its next tick.
                console.error("[tg.broadcast] enqueue failed", id, member.telegramId, err);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Per-recipient consumer
// ---------------------------------------------------------------------------

/**
 * Consume one recipient job. Loads the broadcast, gates on lifecycle, and
 * delegates to `sendBroadcastToRecipient` for the INSERT-claim + grammY
 * round-trip plus counter bump and completion CAS.
 *
 * Returns a structured result for telemetry; never throws on dispatch
 * errors (the failure is accounted via `failedCount`).
 */
export async function processRecipientJob(job: TgBroadcastJob): Promise<ProcessRecipientResult> {
    const broadcast = await getBroadcast(job.broadcastId);
    if (!broadcast) {
        return { status: "skipped", reason: "broadcast_missing" };
    }
    if (broadcast.state !== "sending") {
        return { status: "skipped", reason: "broadcast_state" };
    }

    const result: SendBroadcastResult = await sendBroadcastToRecipient({
        broadcast,
        telegramId: job.telegramId,
        customerId: job.customerId,
    });

    if ("skipped" in result) {
        return { status: "skipped", reason: "already_sent" };
    }
    if ("sent" in result) {
        return { status: "sent", messageId: result.messageId };
    }
    return { status: "failed", error: result.error };
}

// ---------------------------------------------------------------------------
// Cron sweeper
// ---------------------------------------------------------------------------

/**
 * Two-pass sweeper:
 *
 *   A. Promote: broadcasts whose `scheduledAt <= now` go from `scheduled`
 *      to `sending` via `runBroadcast(id, { allowedFromStates: ['scheduled'] })`.
 *      Concurrent ticks race on the CAS — the loser sees
 *      `InvalidTransitionError` and is silently swallowed.
 *
 *   B. Recovery: broadcasts stuck in `sending` for longer than
 *      `settings.stuckAfterMs` re-snapshot the audience, subtract
 *      recipients with any `notification_log` row for the broadcast (sent |
 *      failed | pending), re-enqueue the remainder with chunk pacing, and
 *      bump `startedAt`.
 */
export async function sweepDueBroadcasts(now: Date = new Date()): Promise<SweepResult> {
    const result: SweepResult = {
        promoted: 0,
        recovered: 0,
        recoveredJobs: 0,
        errors: 0,
    };

    // -----------------------------------------------------------------
    // Pass A — Promote due `scheduled` broadcasts.
    // -----------------------------------------------------------------
    const due = await db
        .select({ id: telegramBroadcasts.id })
        .from(telegramBroadcasts)
        .where(
            and(eq(telegramBroadcasts.state, "scheduled"), lte(telegramBroadcasts.scheduledAt, now))
        )
        .orderBy(asc(telegramBroadcasts.scheduledAt));

    for (const c of due) {
        try {
            await runBroadcast(c.id, {
                now,
                allowedFromStates: ["scheduled"],
            });
            result.promoted += 1;
        } catch (err) {
            if (err instanceof InvalidTransitionError) {
                // Another tick beat us to it — silently skip.
                continue;
            }
            console.error("[tg.broadcast.sweep] promote failed", c.id, err);
            result.errors += 1;
        }
    }

    // -----------------------------------------------------------------
    // Pass B — Recover stuck `sending` broadcasts.
    // -----------------------------------------------------------------
    const settings = await getTelegramBroadcastSettings();
    const stuckCutoff = new Date(now.getTime() - settings.stuckAfterMs);

    const stuck = await db
        .select({
            id: telegramBroadcasts.id,
            startedAt: telegramBroadcasts.startedAt,
        })
        .from(telegramBroadcasts)
        .where(
            and(
                eq(telegramBroadcasts.state, "sending"),
                lt(telegramBroadcasts.startedAt, stuckCutoff)
            )
        );

    for (const c of stuck) {
        try {
            const audience = await selectBroadcastAudience();

            // Recipients already represented in `notification_log` (any
            // status — the partial unique index would reject re-claims
            // anyway, and failed sends are explicitly not retried).
            // Dedupe key is `telegramId` to handle unlinked
            // (`customerId IS NULL`) bot users correctly.
            const logged = await db
                .select({
                    telegramId: sql<string>`${notificationLogs.metadata} ->> 'telegramId'`,
                })
                .from(notificationLogs)
                .where(
                    and(
                        eq(notificationLogs.type, "telegram_broadcast"),
                        sql`${notificationLogs.metadata} ->> 'broadcastId' = ${c.id}`
                    )
                );
            const loggedSet = new Set(
                logged.map((r) => r.telegramId).filter((x): x is string => typeof x === "string")
            );

            const pending = audience.filter((m) => !loggedSet.has(String(m.telegramId)));

            if (pending.length > 0) {
                const chunks = chunk(pending, settings.chunkSize);
                for (let i = 0; i < chunks.length; i++) {
                    const delay = i * settings.chunkDelayMs;
                    for (const member of chunks[i]) {
                        try {
                            await enqueueTgBroadcastJob(
                                {
                                    broadcastId: c.id,
                                    telegramId: member.telegramId,
                                    customerId: member.customerId,
                                },
                                delay
                            );
                            result.recoveredJobs += 1;
                        } catch (err) {
                            console.error(
                                "[tg.broadcast.sweep] re-enqueue failed",
                                c.id,
                                member.telegramId,
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
                .update(telegramBroadcasts)
                .set({ startedAt: now, updatedAt: now })
                .where(eq(telegramBroadcasts.id, c.id));

            result.recovered += 1;
        } catch (err) {
            console.error("[tg.broadcast.sweep] recover failed", c.id, err);
            result.errors += 1;
        }
    }

    return result;
}
