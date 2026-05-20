/**
 * Integration test: stuck broadcast recovery.
 *
 * Property 9: Seed broadcast in state='sending' with startedAt = now - 31m;
 * partial notification_log rows covering half the audience; invoke
 * sweepDueBroadcasts(now); assert only the unlogged half are re-enqueued;
 * assert startedAt is bumped to now.
 *
 * Validates: Requirements 6.3
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

import { db, notificationLogs, telegramBotUsers, telegramBroadcasts } from "@/db";

// Mock bot
vi.mock("@/lib/telegram/bot", () => ({
    getBot: () => ({ api: { sendMessage: vi.fn(async () => ({ message_id: 1 })) } }),
}));

// Mock queue to capture enqueues
const { enqueuedJobs } = vi.hoisted(() => ({
    enqueuedJobs: [] as Array<{ broadcastId: string; telegramId: number }>,
}));
vi.mock("@/lib/queue", async (importOriginal) => {
    const orig = await importOriginal<typeof import("@/lib/queue")>();
    return {
        ...orig,
        enqueueTgBroadcastJob: vi.fn(async (job: { broadcastId: string; telegramId: number }) => {
            enqueuedJobs.push(job);
        }),
    };
});

// Override stuck_after_ms to 30 minutes for this test
vi.mock("@/lib/settings", async (importOriginal) => {
    const orig = await importOriginal<typeof import("@/lib/settings")>();
    return {
        ...orig,
        getTelegramBroadcastSettings: vi.fn(async () => ({
            chunkSize: 30,
            chunkDelayMs: 1100,
            stuckAfterMs: 30 * 60 * 1000, // 30 min
            parseMode: "HTML" as const,
        })),
    };
});

import { sweepDueBroadcasts } from "@/lib/telegram-broadcasts/dispatch";

const TEST_TG_IDS = [9000001, 9000002, 9000003, 9000004];
const createdBotUserIds: string[] = [];
let broadcastId: string;

beforeAll(async () => {
    // Seed 4 opted-in bot users
    for (const tgId of TEST_TG_IDS) {
        await db.delete(telegramBotUsers).where(eq(telegramBotUsers.telegramId, tgId));
        const [row] = await db
            .insert(telegramBotUsers)
            .values({ telegramId: tgId, notificationsEnabled: true, firstName: `stuck-${tgId}` })
            .returning({ id: telegramBotUsers.id });
        createdBotUserIds.push(row.id);
    }

    // Seed a stuck broadcast (started 31 min ago)
    const [b] = await db
        .insert(telegramBroadcasts)
        .values({
            title: "Stuck broadcast",
            bodyText: "Застрявшая рассылка",
            state: "sending",
            startedAt: new Date(Date.now() - 31 * 60_000),
            recipientCount: 4,
        })
        .returning({ id: telegramBroadcasts.id });
    broadcastId = b.id;

    // Seed notification_log rows for the first 2 recipients (already processed)
    for (const tgId of [TEST_TG_IDS[0], TEST_TG_IDS[1]]) {
        await db.insert(notificationLogs).values({
            channel: "telegram",
            type: "telegram_broadcast",
            recipient: String(tgId),
            status: "sent",
            metadata: { broadcastId, telegramId: String(tgId), customerId: null },
        });
    }
});

afterAll(async () => {
    await db
        .delete(notificationLogs)
        .where(
            sql`${notificationLogs.type} = 'telegram_broadcast' AND ${notificationLogs.metadata}->>'broadcastId' = ${broadcastId}`
        );
    await db.delete(telegramBroadcasts).where(eq(telegramBroadcasts.id, broadcastId));
    for (const id of createdBotUserIds) {
        await db.delete(telegramBotUsers).where(eq(telegramBotUsers.id, id));
    }
});

describe("telegram-broadcast stuck recovery (Property 9)", () => {
    it("re-enqueues only unlogged recipients and bumps startedAt", async () => {
        const now = new Date();
        const result = await sweepDueBroadcasts(now);

        expect(result.recovered).toBe(1);
        // Only the 2 unlogged recipients should be re-enqueued
        expect(result.recoveredJobs).toBe(2);

        const enqueuedTgIds = enqueuedJobs.map((j) => j.telegramId);
        expect(new Set(enqueuedTgIds)).toEqual(new Set([TEST_TG_IDS[2], TEST_TG_IDS[3]]));

        // startedAt should be bumped
        const [row] = await db
            .select()
            .from(telegramBroadcasts)
            .where(eq(telegramBroadcasts.id, broadcastId));
        expect(row.startedAt!.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1000);
    });
});
