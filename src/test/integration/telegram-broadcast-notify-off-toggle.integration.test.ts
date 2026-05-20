/**
 * Integration test: /notify_off and /notify_on toggle.
 *
 * Property 11: Seed bot user with notificationsEnabled = true; simulate
 * the toggle operations; assert flag is false; toggle again; assert
 * flag is still false (idempotent); toggle on; assert flag is true;
 * toggle on again; assert flag is still true (idempotent).
 *
 * This test exercises the DB operations directly since the bot command
 * handlers are already unit-tested in bot.test.ts. The integration test
 * verifies the real DB round-trip.
 *
 * Validates: Requirements 8.1, 8.2
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { db, telegramBotUsers } from "@/db";

const TEST_TG_ID = 5500001;
let botUserId: string;

beforeAll(async () => {
    await db.delete(telegramBotUsers).where(eq(telegramBotUsers.telegramId, TEST_TG_ID));
    const [row] = await db
        .insert(telegramBotUsers)
        .values({
            telegramId: TEST_TG_ID,
            notificationsEnabled: true,
            firstName: "toggle-test",
        })
        .returning({ id: telegramBotUsers.id });
    botUserId = row.id;
});

afterAll(async () => {
    await db.delete(telegramBotUsers).where(eq(telegramBotUsers.id, botUserId));
});

async function getNotificationsEnabled(): Promise<boolean> {
    const [row] = await db
        .select({ notificationsEnabled: telegramBotUsers.notificationsEnabled })
        .from(telegramBotUsers)
        .where(eq(telegramBotUsers.id, botUserId));
    return row.notificationsEnabled!;
}

async function setNotificationsEnabled(value: boolean): Promise<void> {
    await db
        .update(telegramBotUsers)
        .set({ notificationsEnabled: value, lastInteractionAt: new Date() })
        .where(eq(telegramBotUsers.id, botUserId));
}

describe("/notify_off and /notify_on toggle (Property 11)", () => {
    it("/notify_off flips to false", async () => {
        await setNotificationsEnabled(false);
        expect(await getNotificationsEnabled()).toBe(false);
    });

    it("/notify_off again is idempotent (still false)", async () => {
        await setNotificationsEnabled(false);
        expect(await getNotificationsEnabled()).toBe(false);
    });

    it("/notify_on flips to true", async () => {
        await setNotificationsEnabled(true);
        expect(await getNotificationsEnabled()).toBe(true);
    });

    it("/notify_on again is idempotent (still true)", async () => {
        await setNotificationsEnabled(true);
        expect(await getNotificationsEnabled()).toBe(true);
    });
});
