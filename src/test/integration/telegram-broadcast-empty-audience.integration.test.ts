/**
 * Integration test: empty audience fast-path.
 *
 * Property 7: Run a broadcast with no opted-in telegramBotUsers;
 * assert direct sending → sent transition; assert recipientCount =
 * sentCount = failedCount = 0; assert completedAt is set; assert no
 * BullMQ job is enqueued.
 *
 * Validates: Requirements 3.4, 4.1
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { db, telegramBroadcasts } from "@/db";

// Mock the audience to return empty
vi.mock("@/lib/telegram-broadcasts/audience", () => ({
    selectBroadcastAudience: vi.fn(async () => []),
}));

// Mock the queue so we can assert no jobs are enqueued
const { enqueueMock } = vi.hoisted(() => ({
    enqueueMock: vi.fn(async () => undefined),
}));
vi.mock("@/lib/queue", async (importOriginal) => {
    const orig = await importOriginal<typeof import("@/lib/queue")>();
    return { ...orig, enqueueTgBroadcastJob: enqueueMock };
});

import { runBroadcast } from "@/lib/telegram-broadcasts/dispatch";

const createdIds: string[] = [];

afterAll(async () => {
    for (const id of createdIds) {
        await db.delete(telegramBroadcasts).where(eq(telegramBroadcasts.id, id));
    }
});

describe("telegram-broadcast empty audience (Property 7)", () => {
    let broadcastId: string;

    it("creates a draft broadcast and sends with empty audience → directly sent", async () => {
        // Insert directly to avoid FK constraint on createdByUserId
        const [row] = await db
            .insert(telegramBroadcasts)
            .values({
                title: "Пустая аудитория",
                bodyText: "Тест пустой аудитории",
                state: "draft",
            })
            .returning();
        broadcastId = row.id;
        createdIds.push(broadcastId);

        await runBroadcast(broadcastId, { allowedFromStates: ["draft"] });

        // Verify final state
        const [updated] = await db
            .select()
            .from(telegramBroadcasts)
            .where(eq(telegramBroadcasts.id, broadcastId));

        expect(updated.state).toBe("sent");
        expect(updated.recipientCount).toBe(0);
        expect(updated.sentCount).toBe(0);
        expect(updated.failedCount).toBe(0);
        expect(updated.completedAt).not.toBeNull();
    });

    it("no BullMQ jobs were enqueued", () => {
        expect(enqueueMock).not.toHaveBeenCalled();
    });
});
