/**
 * Telegram broadcast audience selector.
 *
 * Returns the set of Telegram bot users eligible to receive a broadcast:
 *   - notificationsEnabled = true
 *
 * The `customerId` column is deliberately not filtered. Unlinked bot users
 * (`customerId = NULL`) still receive broadcasts as long as their
 * `notifications_enabled` flag is true — they had to send `/start` to exist
 * in the table at all, which is the consent signal.
 *
 * Ordering is stable by `telegramId` ascending so a re-snapshot in the
 * stuck-recovery sweeper produces the same chunk boundaries as the
 * original fanout.
 *
 * Pure DB module — no side effects.
 */
import "server-only";

import { asc, eq } from "drizzle-orm";

import { db, telegramBotUsers } from "@/db";

export interface BroadcastAudienceMember {
    telegramId: number;
    customerId: string | null;
}

export async function selectBroadcastAudience(): Promise<BroadcastAudienceMember[]> {
    const rows = await db
        .select({
            telegramId: telegramBotUsers.telegramId,
            customerId: telegramBotUsers.customerId,
        })
        .from(telegramBotUsers)
        .where(eq(telegramBotUsers.notificationsEnabled, true))
        .orderBy(asc(telegramBotUsers.telegramId));
    return rows;
}
