/**
 * Integration test: null-customer fanout.
 *
 * Property 15: Seed an opted-in telegramBotUsers row with customerId = NULL;
 * run broadcast end-to-end; assert exactly one notification_log row written
 * with metadata->>'customerId' IS NULL and metadata->>'telegramId' set;
 * assert one bot.api.sendMessage call. Re-invoke processRecipientJob for
 * the same recipient; assert no second row (partial unique index rejects
 * the duplicate even with NULL customer).
 *
 * Validates: Requirements 1.4, 4.2, 5.2
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

import { db, notificationLogs, telegramBotUsers, telegramBroadcasts } from "@/db";

// Mock bot
const { sendMessageMock } = vi.hoisted(() => ({
    sendMessageMock: vi.fn(async () => ({ message_id: 5555 })),
}));
vi.mock("@/lib/telegram/bot", () => ({
    getBot: () => ({ api: { sendMessage: sendMessageMock } }),
}));

// Mock queue to capture jobs
const { enqueuedJobs } = vi.hoisted(() => ({
    enqueuedJobs: [] as Array<{
        broadcastId: string;
        telegramId: number;
        customerId: string | null;
    }>,
}));
vi.mock("@/lib/queue", async (importOriginal) => {
    const orig = await importOriginal<typeof import("@/lib/queue")>();
    return {
        ...orig,
        enqueueTgBroadcastJob: vi.fn(
            async (job: { broadcastId: string; telegramId: number; customerId: string | null }) => {
                enqueuedJobs.push(job);
            }
        ),
    };
});

import { processRecipientJob, runBroadcast } from "@/lib/telegram-broadcasts/dispatch";

const TEST_TG_ID = 6000099;
let botUserId: string;
let broadcastId: string;

beforeAll(async () => {
    await db.delete(telegramBotUsers).where(eq(telegramBotUsers.telegramId, TEST_TG_ID));
    const [row] = await db
        .insert(telegramBotUsers)
        .values({
            telegramId: TEST_TG_ID,
            notificationsEnabled: true,
            customerId: null,
            firstName: "null-customer-test",
        })
        .returning({ id: telegramBotUsers.id });
    botUserId = row.id;
});

afterAll(async () => {
    if (broadcastId) {
        await db
            .delete(notificationLogs)
            .where(
                sql`${notificationLogs.type} = 'telegram_broadcast' AND ${notificationLogs.metadata}->>'broadcastId' = ${broadcastId}`
            );
        await db.delete(telegramBroadcasts).where(eq(telegramBroadcasts.id, broadcastId));
    }
    await db.delete(telegramBotUsers).where(eq(telegramBotUsers.id, botUserId));
});

describe("telegram-broadcast null-customer fanout (Property 15)", () => {
    it("creates and sends broadcast to unlinked bot user", async () => {
        const [row] = await db
            .insert(telegramBroadcasts)
            .values({
                title: "Null customer test",
                bodyText: "Тест без клиента",
                state: "draft",
            })
            .returning();
        broadcastId = row.id;

        await runBroadcast(broadcastId, { allowedFromStates: ["draft"] });
        expect(enqueuedJobs.length).toBe(1);
        expect(enqueuedJobs[0].customerId).toBeNull();
    });

    it("processRecipientJob writes one notification_log row with null customerId", async () => {
        await processRecipientJob(enqueuedJobs[0]);

        const rows = await db
            .select()
            .from(notificationLogs)
            .where(
                sql`${notificationLogs.type} = 'telegram_broadcast' AND ${notificationLogs.metadata}->>'broadcastId' = ${broadcastId}`
            );

        expect(rows).toHaveLength(1);
        const meta = rows[0].metadata as { telegramId: string; customerId: string | null };
        expect(meta.telegramId).toBe(String(TEST_TG_ID));
        expect(meta.customerId).toBeNull();
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
    });

    it("re-invoking processRecipientJob is rejected by partial unique index", async () => {
        sendMessageMock.mockClear();
        const result = await processRecipientJob(enqueuedJobs[0]);
        expect(result.status).toBe("skipped");

        const rows = await db
            .select()
            .from(notificationLogs)
            .where(
                sql`${notificationLogs.type} = 'telegram_broadcast' AND ${notificationLogs.metadata}->>'broadcastId' = ${broadcastId}`
            );
        expect(rows).toHaveLength(1);
        expect(sendMessageMock).not.toHaveBeenCalled();
    });
});
