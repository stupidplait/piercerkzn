/**
 * Unit tests for auth-utils.
 *
 *   - hashPassword / verifyPassword roundtrip + tamper resistance
 *   - verifyTelegramAuth: positive case, bad hash, missing fields, stale auth
 */
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
    hashPassword,
    verifyPassword,
    verifyTelegramAuth,
    type TelegramAuthData,
} from "./auth-utils";

describe("password hashing", () => {
    it("roundtrips a valid password", async () => {
        const hash = await hashPassword("correct horse battery staple");
        expect(hash).toMatch(/^\$argon2id\$/u);
        expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    });

    it("rejects the wrong password", async () => {
        const hash = await hashPassword("correct horse battery staple");
        expect(await verifyPassword(hash, "wrong horse")).toBe(false);
    });

    it("rejects a malformed hash without throwing", async () => {
        expect(await verifyPassword("not-a-real-hash", "anything")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Telegram Login Widget
// ---------------------------------------------------------------------------
function buildSignedTelegram(
    botToken: string,
    overrides: Partial<TelegramAuthData> = {}
): TelegramAuthData {
    const base = {
        id: 4242 as number,
        first_name: "Алина" as string,
        username: "alina" as string | undefined,
        photo_url: "https://example.com/a.png" as string | undefined,
        auth_date: Math.floor(Date.now() / 1000) as number,
        ...overrides,
    };
    const entries = Object.entries(base)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
    const secretKey = createHash("sha256").update(botToken).digest();
    const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    return { ...base, hash } as TelegramAuthData;
}

describe("verifyTelegramAuth", () => {
    const token = "1234567890:TESTTESTTESTTESTTESTTESTTESTTESTTES";

    it("accepts a freshly signed payload", () => {
        const payload = buildSignedTelegram(token);
        expect(verifyTelegramAuth(payload, token)).toEqual({ valid: true });
    });

    it("rejects when hash is tampered", () => {
        const payload = buildSignedTelegram(token);
        payload.hash = payload.hash.replace(/^./u, payload.hash.startsWith("a") ? "b" : "a");
        expect(verifyTelegramAuth(payload, token).valid).toBe(false);
    });

    it("rejects when bot token differs", () => {
        const payload = buildSignedTelegram(token);
        expect(
            verifyTelegramAuth(payload, "9999999999:OTHEROTHEROTHEROTHEROTHEROTHEROTHE").valid
        ).toBe(false);
    });

    it("rejects when required fields are missing", () => {
        const payload = buildSignedTelegram(token);
        // remove a non-hash field — recompute would change hash, which is the point
        delete (payload as { id?: unknown }).id;
        expect(verifyTelegramAuth(payload as TelegramAuthData, token).reason).toBe(
            "missing_fields"
        );
    });

    it("rejects stale auth_date", () => {
        const oldTimestamp = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
        const payload = buildSignedTelegram(token, { auth_date: oldTimestamp });
        expect(verifyTelegramAuth(payload, token).reason).toBe("stale");
    });
});
