/**
 * Integration test: cron sweep promote.
 *
 * Property 8: Seed broadcast with state='scheduled' AND scheduledAt = now - 1m;
 * invoke sweepDueBroadcasts; assert promotion to sending and per-recipient
 * jobs enqueued; seed a second broadcast with scheduledAt = now + 1m and
 * assert it is NOT promoted.
 *
 * Validates: Requirements 6.1, 6.2
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { db, telegramBroadcasts, telegramBotUsers } from "@/db";

// Mock bot
vi.mock("@/lib/telegram/bot", () => ({
    getBot: () => ({ api: { sendMessage: vi.fn(async () => ({ message_id: 1 })) } }),
}));

// Mock queue to capture enqueues
const { enqueuedJobs } = vi.hoisted(() => ({
    enqueuedJobs: [] as unknown[],
}));
vi.mock("@/lib/queue", async (importOriginal) => {
    const orig = await importOriginal<typeof import("@/lib/queue")>();
    return {
        ...orig,
        enqueueTgBroadcastJob: vi.fn(async (job: unknown) => {
            enqueuedJobs.push(job);
        }),
    };
});

import { sweepDueBroadcasts } from "@/lib/telegram-broadcasts/dispatch";

const TEST_TG_ID = 8000001;
let dueBroadcastId: string;
let futureBroadcastId: string;
let botUserId: string;

beforeAll(async () => {
    // Seed one opted-in bot user
    await db.delete(telegramBotUsers).where(eq(telegramBotUsers.telegramId, TEST_TG_ID));
    const [bu] = await db
        .insert(telegramBotUsers)
        .values({ telegramId: TEST_TG_ID, notificationsEnabled: true, firstName: "sweep-test" })
        .returning({ id: telegramBotUsers.id });
    botUserId = bu.id;

    // Seed due broadcast (scheduledAt in the past)
    const [due] = await db
        .insert(telegramBroadcasts)
        .values({
            title: "Due broadcast",
            bodyText: "Должна быть отправлена",
            state: "scheduled",
            scheduledAt: new Date(Date.now() - 60_000),
        })
        .returning({ id: telegramBroadcasts.id });
    dueBroadcastId = due.id;

    // Seed future broadcast (scheduledAt in the future)
    const [future] = await db
        .insert(telegramBroadcasts)
        .values({
            title: "Future broadcast",
            bodyText: "Не должна быть отправлена",
            state: "scheduled",
            scheduledAt: new Date(Date.now() + 5 * 60_000),
        })
        .returning({ id: telegramBroadcasts.id });
    futureBroadcastId = future.id;
});

afterAll(async () => {
    await db.delete(telegramBroadcasts).where(eq(telegramBroadcasts.id, dueBroadcastId));
    await db.delete(telegramBroadcasts).where(eq(telegramBroadcasts.id, futureBroadcastId));
    await db.delete(telegramBotUsers).where(eq(telegramBotUsers.id, botUserId));
});

describe("cron sweep promote (Property 8)", () => {
    it("promotes due broadcast and enqueues jobs; leaves future broadcast untouched", async () => {
        const result = await sweepDueBroadcasts(new Date());

        expect(result.promoted).toBeGreaterThanOrEqual(1);

        // Due broadcast should now be in 'sending' (or 'sent' if audience was processed inline)
        const [dueRow] = await db
            .select()
            .from(telegramBroadcasts)
            .where(eq(telegramBroadcasts.id, dueBroadcastId));
        expect(["sending", "sent"]).toContain(dueRow.state);

        // Future broadcast should still be 'scheduled'
        const [futureRow] = await db
            .select()
            .from(telegramBroadcasts)
            .where(eq(telegramBroadcasts.id, futureBroadcastId));
        expect(futureRow.state).toBe("scheduled");

        // Jobs were enqueued for the due broadcast
        expect(enqueuedJobs.length).toBeGreaterThanOrEqual(1);
    });
});
