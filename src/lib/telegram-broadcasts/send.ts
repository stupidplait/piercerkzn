/**
 * Per-recipient send helper for Telegram broadcasts.
 *
 * Uses INSERT-claim semantics: inserts the `notification_log` row with
 * `status='pending'` BEFORE calling bot.api.sendMessage so the partial
 * unique index `uniq_notif_telegram_broadcast_recipient` claims the
 * (broadcastId, telegramId) slot atomically. On 23505 (unique_violation),
 * skips the send. On dispatch success, updates the row to status='sent'
 * and bumps `telegram_broadcast.sentCount`. On failure, updates to
 * status='failed' and bumps `failedCount`. After every counter bump,
 * runs the completion CAS that flips state from 'sending' → 'sent' when
 * `sentCount + failedCount === recipientCount`.
 */
import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db, notificationLogs, telegramBroadcasts, type TelegramBroadcast } from "@/db";
import { pgErrorCode } from "@/lib/api";
import { getBot } from "@/lib/telegram/bot";

import { renderBroadcastPayload } from "./render";

export interface SendBroadcastToRecipientParams {
    broadcast: TelegramBroadcast;
    telegramId: number;
    customerId: string | null;
    now?: Date;
}

export type SendBroadcastResult =
    | { sent: true; messageId: number }
    | { skipped: true; reason: "already_sent" }
    | { failed: true; error: string };

export async function sendBroadcastToRecipient(
    params: SendBroadcastToRecipientParams
): Promise<SendBroadcastResult> {
    const { broadcast, telegramId, customerId } = params;
    const now = params.now ?? new Date();

    // 1. Build payload up front so a render error never claims the slot.
    let payload;
    try {
        payload = renderBroadcastPayload(broadcast);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { failed: true, error: `render_failed:${message}` };
    }

    // 2. INSERT the claim row. The partial unique index gates duplicates.
    let inserted: { id: string } | undefined;
    try {
        const [row] = await db
            .insert(notificationLogs)
            .values({
                customerId,
                channel: "telegram",
                type: "telegram_broadcast",
                recipient: String(telegramId),
                subject: broadcast.title,
                contentPreview: broadcast.bodyText.slice(0, 500),
                status: "pending",
                metadata: {
                    broadcastId: broadcast.id,
                    telegramId: String(telegramId),
                    customerId,
                },
            })
            .returning({ id: notificationLogs.id });
        inserted = row;
    } catch (err) {
        if (pgErrorCode(err) === "23505") {
            return { skipped: true, reason: "already_sent" };
        }
        throw err;
    }
    if (!inserted) {
        return { failed: true, error: "claim_insert_returned_no_row" };
    }

    // 3. Send via grammY.
    try {
        const bot = getBot();
        const msg = await bot.api.sendMessage(telegramId, payload.text, {
            parse_mode: payload.parse_mode,
            reply_markup: payload.reply_markup,
        });

        // 4a. Mark sent.
        await db
            .update(notificationLogs)
            .set({
                status: "sent",
                providerId: String(msg.message_id),
                sentAt: now,
            })
            .where(eq(notificationLogs.id, inserted.id));

        // 4b. Bump sentCount and check completion atomically.
        await db
            .update(telegramBroadcasts)
            .set({
                sentCount: sql`${telegramBroadcasts.sentCount} + 1`,
                updatedAt: now,
            })
            .where(eq(telegramBroadcasts.id, broadcast.id));

        await maybeFinaliseBroadcast(broadcast.id, now);

        return { sent: true, messageId: msg.message_id };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[tg.broadcast.send] failed broadcast=${broadcast.id} tg=${telegramId}`, err);

        // 5a. Mark failed (best-effort).
        await db
            .update(notificationLogs)
            .set({
                status: "failed",
                metadata: sql`${notificationLogs.metadata} || ${JSON.stringify({ error: errorMsg })}::jsonb`,
            })
            .where(eq(notificationLogs.id, inserted.id))
            .catch(() => {});

        // 5b. Bump failedCount and check completion.
        await db
            .update(telegramBroadcasts)
            .set({
                failedCount: sql`${telegramBroadcasts.failedCount} + 1`,
                updatedAt: now,
            })
            .where(eq(telegramBroadcasts.id, broadcast.id));

        await maybeFinaliseBroadcast(broadcast.id, now);

        return { failed: true, error: errorMsg };
    }
}

/**
 * Atomic completion check: when `sentCount + failedCount === recipientCount`,
 * CAS state from `sending` to `sent`. Single SQL is safe under concurrent
 * finalisations — only the very last recipient flips the state.
 */
async function maybeFinaliseBroadcast(broadcastId: string, now: Date): Promise<void> {
    await db
        .update(telegramBroadcasts)
        .set({ state: "sent", completedAt: now, updatedAt: now })
        .where(
            and(
                eq(telegramBroadcasts.id, broadcastId),
                eq(telegramBroadcasts.state, "sending"),
                sql`${telegramBroadcasts.sentCount} + ${telegramBroadcasts.failedCount} = ${telegramBroadcasts.recipientCount}`
            )
        );
}
