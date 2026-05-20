/**
 * Integration test: fanout idempotency.
 *
 * Property 5: Seed N opted-in telegramBotUsers (mix of linked + unlinked);
 * call runBroadcast; advance the worker via direct processRecipientJob
 * invocation; assert exactly 1 notification_log row per (broadcastId,
 * telegramId); re-invoke processRecipientJob for the same pairs; assert
 * no second row, no second bot.api.sendMessage call.
 *
 * Validates: Requirements 5.1, 5.2, 5.3, 12.1
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

import { db, notificationLogs, telegramBotUsers, telegramBroadcasts } from "@/db";

// Mock bot.api.sendMessage
const { sendMessageMock } = vi.hoisted(() => ({
    sendMessageMock: vi.fn(async () => ({ message_id: 9999 })),
}));
vi.mock("@/lib/telegram/bot", () => ({
    getBot: () => ({ api: { sendMessage: sendMessageMock } }),
}));

// Mock queue to capture jobs instead of enqueuing
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

const TEST_TG_IDS = [7000001, 7000002, 7000003];
const createdBotUserIds: string[] = [];
let broadcastId: string;

beforeAll(async () => {
    // Seed telegram bot users
    for (let i = 0; i < TEST_TG_IDS.length; i++) {
        const tgId = TEST_TG_IDS[i];
        await db.delete(telegramBotUsers).where(eq(telegramBotUsers.telegramId, tgId));
        const [row] = await db
            .insert(telegramBotUsers)
            .values({
                telegramId: tgId,
                notificationsEnabled: true,
                customerId: i === 2 ? null : undefined, // last one is unlinked
                firstName: `test-fanout-${tgId}`,
            })
            .returning({ id: telegramBotUsers.id });
        createdBotUserIds.push(row.id);
    }
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
    for (const id of createdBotUserIds) {
        await db.delete(telegramBotUsers).where(eq(telegramBotUsers.id, id));
    }
});

describe("telegram-broadcast fanout idempotency (Property 5)", () => {
    it("creates and sends a broadcast", async () => {
        // Insert directly to avoid FK constraint on createdByUserId
        const [row] = await db
            .insert(telegramBroadcasts)
            .values({
                title: "Fanout idempotency test",
                bodyText: "Тест идемпотентности",
                state: "draft",
            })
            .returning();
        broadcastId = row.id;

        await runBroadcast(broadcastId, { allowedFromStates: ["draft"] });
        expect(enqueuedJobs.length).toBe(TEST_TG_IDS.length);
    });

    it("processRecipientJob creates exactly 1 notification_log row per recipient", async () => {
        for (const job of enqueuedJobs) {
            await processRecipientJob(job);
        }

        const rows = await db
            .select()
            .from(notificationLogs)
            .where(
                sql`${notificationLogs.type} = 'telegram_broadcast' AND ${notificationLogs.metadata}->>'broadcastId' = ${broadcastId}`
            );

        expect(rows).toHaveLength(TEST_TG_IDS.length);
        expect(sendMessageMock).toHaveBeenCalledTimes(TEST_TG_IDS.length);
    });

    it("re-invoking processRecipientJob for same pairs does NOT create second rows", async () => {
        sendMessageMock.mockClear();

        for (const job of enqueuedJobs) {
            const result = await processRecipientJob(job);
            expect(result.status).toBe("skipped");
        }

        const rows = await db
            .select()
            .from(notificationLogs)
            .where(
                sql`${notificationLogs.type} = 'telegram_broadcast' AND ${notificationLogs.metadata}->>'broadcastId' = ${broadcastId}`
            );

        expect(rows).toHaveLength(TEST_TG_IDS.length);
        expect(sendMessageMock).not.toHaveBeenCalled();
    });
});
