/**
 * Integration test: telegram broadcast author → schedule lifecycle.
 *
 * Property 3: POST/PATCH/schedule lifecycle through real DB operations;
 * assert state transitions persisted; assert PATCH against a `scheduled`
 * broadcast returns 409-equivalent and the row's content fields are
 * byte-for-byte unchanged.
 *
 * Validates: Requirements 2.2, 2.4, 2.6, 3.5
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, telegramBroadcasts } from "@/db";
import {
    createBroadcast,
    deleteBroadcast,
    InvalidTransitionError,
    scheduleBroadcast,
    updateBroadcast,
} from "@/lib/telegram-broadcasts/dispatch";

const createdIds: string[] = [];

afterAll(async () => {
    for (const id of createdIds) {
        await db.delete(telegramBroadcasts).where(eq(telegramBroadcasts.id, id));
    }
});

describe("telegram-broadcast author → schedule lifecycle (Property 3)", () => {
    let broadcastId: string;

    it("createBroadcast creates a draft broadcast", async () => {
        const row = await createBroadcast({
            title: "Интеграционный тест",
            bodyText: "Привет из интеграционного теста!",
            parseMode: "HTML",
        });
        expect(row.state).toBe("draft");
        expect(row.id).toBeDefined();
        broadcastId = row.id;
        createdIds.push(broadcastId);
    });

    it("updateBroadcast updates title while in draft", async () => {
        const row = await updateBroadcast(broadcastId, { title: "Обновлённый заголовок" });
        expect(row.title).toBe("Обновлённый заголовок");
        expect(row.state).toBe("draft");
    });

    it("scheduleBroadcast transitions to scheduled", async () => {
        const scheduledAt = new Date(Date.now() + 10 * 60_000);
        const row = await scheduleBroadcast(broadcastId, scheduledAt);
        expect(row.state).toBe("scheduled");
        expect(row.scheduledAt).not.toBeNull();
    });

    it("updateBroadcast against a scheduled broadcast throws InvalidTransitionError", async () => {
        // Snapshot current content
        const [before] = await db
            .select()
            .from(telegramBroadcasts)
            .where(eq(telegramBroadcasts.id, broadcastId));

        await expect(
            updateBroadcast(broadcastId, { title: "Не должен измениться" })
        ).rejects.toThrow(InvalidTransitionError);

        // Verify content unchanged
        const [after] = await db
            .select()
            .from(telegramBroadcasts)
            .where(eq(telegramBroadcasts.id, broadcastId));
        expect(after.title).toBe(before.title);
        expect(after.bodyText).toBe(before.bodyText);
    });

    it("deleteBroadcast against a scheduled broadcast throws InvalidTransitionError", async () => {
        await expect(deleteBroadcast(broadcastId)).rejects.toThrow(InvalidTransitionError);
    });
});
