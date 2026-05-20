/**
 * Integration test: render preview + test-send.
 *
 * Property 10, 12: Drive both the /preview admin route and the /test-send
 * admin route end-to-end with a seeded broadcast row containing Russian
 * bodyText, an inline button, and parseMode='HTML'; assert the /preview
 * JSON deep-equals renderBroadcastPayload(b); assert /test-send invokes
 * bot.api.sendMessage with the same payload (no notification_log write,
 * no counter mutation, no state change).
 *
 * Validates: Requirements 2.9, 2.10, 7.1, 7.2, 7.3
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

import { db, notificationLogs, telegramBroadcasts } from "@/db";
import { readResponse } from "@/test/integration/helpers";
import { renderBroadcastPayload } from "@/lib/telegram-broadcasts/render";

import { GET as previewGet } from "@/app/api/admin/tg-broadcasts/[id]/preview/route";
import { POST as testSendPost } from "@/app/api/admin/tg-broadcasts/[id]/test-send/route";

// Mock bot
const { sendMessageMock } = vi.hoisted(() => ({
    sendMessageMock: vi.fn(async () => ({ message_id: 7777 })),
}));
vi.mock("@/lib/telegram/bot", () => ({
    getBot: () => ({ api: { sendMessage: sendMessageMock } }),
}));

let broadcastId: string;

function makeCtx(id: string) {
    return { params: Promise.resolve({ id }) };
}

beforeAll(async () => {
    const [row] = await db
        .insert(telegramBroadcasts)
        .values({
            title: "Тест превью",
            bodyText: "Привет! Это <b>тестовая</b> рассылка.",
            parseMode: "HTML",
            inlineButtonLabel: "Открыть",
            inlineButtonUrl: "https://piercerkzn.ru/promo",
            state: "draft",
        })
        .returning();
    broadcastId = row.id;
});

afterAll(async () => {
    await db
        .delete(notificationLogs)
        .where(
            sql`${notificationLogs.type} = 'telegram_broadcast' AND ${notificationLogs.metadata}->>'broadcastId' = ${broadcastId}`
        );
    await db.delete(telegramBroadcasts).where(eq(telegramBroadcasts.id, broadcastId));
});

describe("render integration: preview + test-send (Property 10, 12)", () => {
    it("GET /preview returns renderBroadcastPayload output", async () => {
        const req = new Request(`http://test.local/api/admin/tg-broadcasts/${broadcastId}/preview`);
        const res = await previewGet(req, makeCtx(broadcastId));
        const { status, json } = await readResponse(res);
        expect(status).toBe(200);

        // Compute expected payload
        const [broadcast] = await db
            .select()
            .from(telegramBroadcasts)
            .where(eq(telegramBroadcasts.id, broadcastId));
        const expected = renderBroadcastPayload(broadcast);

        expect(json).toEqual(expected);
        expect(json).toMatchObject({
            text: "Привет! Это <b>тестовая</b> рассылка.",
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [[{ text: "Открыть", url: "https://piercerkzn.ru/promo" }]],
            },
        });
    });

    it("POST /test-send invokes sendMessage with same payload, no DB side-effects", async () => {
        const req = new Request(
            `http://test.local/api/admin/tg-broadcasts/${broadcastId}/test-send`,
            {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ telegramId: 12345 }),
            }
        );
        const res = await testSendPost(req, makeCtx(broadcastId));
        const { status, json } = await readResponse<{ ok: boolean; messageId: number }>(res);
        expect(status).toBe(200);
        expect(json.ok).toBe(true);
        expect(json.messageId).toBe(7777);

        // sendMessage was called with the rendered payload
        expect(sendMessageMock).toHaveBeenCalledTimes(1);
        expect(sendMessageMock).toHaveBeenCalledWith(
            12345,
            "Привет! Это <b>тестовая</b> рассылка.",
            expect.objectContaining({
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [[{ text: "Открыть", url: "https://piercerkzn.ru/promo" }]],
                },
            })
        );

        // No notification_log row was created
        const logRows = await db
            .select()
            .from(notificationLogs)
            .where(
                sql`${notificationLogs.type} = 'telegram_broadcast' AND ${notificationLogs.metadata}->>'broadcastId' = ${broadcastId}`
            );
        expect(logRows).toHaveLength(0);

        // Broadcast state and counters unchanged
        const [broadcast] = await db
            .select()
            .from(telegramBroadcasts)
            .where(eq(telegramBroadcasts.id, broadcastId));
        expect(broadcast.state).toBe("draft");
        expect(broadcast.recipientCount).toBe(0);
        expect(broadcast.sentCount).toBe(0);
        expect(broadcast.failedCount).toBe(0);
    });
});
