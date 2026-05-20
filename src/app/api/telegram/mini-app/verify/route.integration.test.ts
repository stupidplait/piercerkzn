/**
 * Integration tests for /api/telegram/mini-app/verify route.
 *
 * Validates Properties: 7, 8, 9
 */
import { createHmac } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import { POST } from "@/app/api/telegram/mini-app/verify/route";
import { db, telegramBotUsers } from "@/db";
import { buildRequest, makeTestTag, readResponse } from "@/test/integration/helpers";

const TAG = makeTestTag("verify");
const BOT_TOKEN = "1234567890:INTEGRATION_TEST_TOKEN";

let seededUserId: string;
const SEEDED_TG_ID = 999_888_777;

function signInitData(params: Record<string, string>, botToken: string): string {
    const lines = Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .sort();
    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const hash = createHmac("sha256", secretKey).update(lines.join("\n")).digest("hex");
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) sp.append(k, v);
    sp.append("hash", hash);
    return sp.toString();
}

beforeAll(async () => {
    process.env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;

    const [row] = await db
        .insert(telegramBotUsers)
        .values({
            telegramId: SEEDED_TG_ID,
            firstName: TAG,
            telegramUsername: `${TAG}_user`,
            languageCode: "ru",
            notificationsEnabled: true,
        })
        .returning({ id: telegramBotUsers.id });
    seededUserId = row.id;
});

afterAll(async () => {
    if (seededUserId) {
        await db.delete(telegramBotUsers).where(eq(telegramBotUsers.id, seededUserId));
    }
    delete process.env.TELEGRAM_BOT_TOKEN;
});

describe("/api/telegram/mini-app/verify", () => {
    it("rejects forged initData with bad_signature (Property 7)", async () => {
        const initData = signInitData(
            { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 123 }) },
            "wrong-token"
        );
        const req = buildRequest("/api/telegram/mini-app/verify", "POST", { body: { initData } });
        const res = await POST(req);
        const { status, json } = await readResponse(res);
        expect(status).toBe(401);
        expect(json).toMatchObject({
            error: { code: "invalid_init_data", details: { reason: "bad_signature" } },
        });
    });

    it("rejects stale auth_date (Property 7)", async () => {
        const staleDate = Math.floor(Date.now() / 1000) - 7 * 86400;
        const initData = signInitData(
            { auth_date: String(staleDate), user: JSON.stringify({ id: 123 }) },
            BOT_TOKEN
        );
        const req = buildRequest("/api/telegram/mini-app/verify", "POST", { body: { initData } });
        const res = await POST(req);
        const { status, json } = await readResponse(res);
        expect(status).toBe(401);
        expect(json).toMatchObject({
            error: { code: "invalid_init_data", details: { reason: "stale_auth_date" } },
        });
    });

    it("returns telegramBotUser when user.id matches a row (Property 8)", async () => {
        const initData = signInitData(
            {
                auth_date: String(Math.floor(Date.now() / 1000)),
                user: JSON.stringify({ id: SEEDED_TG_ID, first_name: "Test" }),
            },
            BOT_TOKEN
        );
        const req = buildRequest("/api/telegram/mini-app/verify", "POST", { body: { initData } });
        const res = await POST(req);
        const { status, json } = await readResponse<{
            telegramBotUser: { id: string; telegramId: string };
        }>(res);
        expect(status).toBe(200);
        expect(json.telegramBotUser).not.toBeNull();
        expect(json.telegramBotUser!.id).toBe(seededUserId);
        expect(json.telegramBotUser!.telegramId).toBe(String(SEEDED_TG_ID));
    });

    it("returns null telegramBotUser when no row matches (Property 9)", async () => {
        const initData = signInitData(
            {
                auth_date: String(Math.floor(Date.now() / 1000)),
                user: JSON.stringify({ id: 111_222_333, first_name: "Nobody" }),
            },
            BOT_TOKEN
        );
        const req = buildRequest("/api/telegram/mini-app/verify", "POST", { body: { initData } });
        const res = await POST(req);
        const { status, json } = await readResponse<{ telegramBotUser: null }>(res);
        expect(status).toBe(200);
        expect(json.telegramBotUser).toBeNull();
    });

    it("returns 503 when TELEGRAM_BOT_TOKEN is unset", async () => {
        const saved = process.env.TELEGRAM_BOT_TOKEN;
        delete process.env.TELEGRAM_BOT_TOKEN;
        try {
            const req = buildRequest("/api/telegram/mini-app/verify", "POST", {
                body: { initData: "x=1" },
            });
            const res = await POST(req);
            const { status, json } = await readResponse(res);
            expect(status).toBe(503);
            expect(json).toMatchObject({ error: { code: "mini_app_not_configured" } });
        } finally {
            process.env.TELEGRAM_BOT_TOKEN = saved;
        }
    });
});
