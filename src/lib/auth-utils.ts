/**
 * Server-only auth utilities.
 *
 * Imports `@node-rs/argon2` (native module) — must NOT be imported from
 * edge runtime (middleware). Only `auth.ts` and Server Actions should
 * touch this file. `auth.config.ts` is edge-safe and never imports it.
 */
import "server-only";

import { hash, verify } from "@node-rs/argon2";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Password hashing — Argon2id (default for @node-rs/argon2),
// OWASP-recommended params (2024).
// memoryCost: 19 MiB, timeCost: 2, parallelism: 1, output: 32 bytes
// ---------------------------------------------------------------------------
// `Algorithm` is a const enum; `isolatedModules` forbids referencing it.
// Argon2id is the default algorithm so we omit it.
const ARGON2_OPTS = {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
    outputLen: 32,
} as const;

export async function hashPassword(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
    try {
        return await verify(storedHash, plain);
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Telegram Login Widget — HMAC-SHA256 verification
// Spec: https://core.telegram.org/widgets/login#checking-authorization
//
// Telegram POSTs:
//   { id, first_name, last_name?, username?, photo_url?, auth_date, hash }
// We rebuild the data-check-string, HMAC it with SHA256(bot_token), and
// constant-time compare against the supplied hash.
// ---------------------------------------------------------------------------
export interface TelegramAuthData {
    id: number | string;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    auth_date: number | string;
    hash: string;
    [key: string]: unknown;
}

export interface TelegramVerifyResult {
    valid: boolean;
    reason?: "missing_fields" | "bad_hash" | "stale";
}

export function verifyTelegramAuth(
    data: TelegramAuthData,
    botToken: string,
    maxAgeSeconds = 86_400 // 24h
): TelegramVerifyResult {
    if (!data?.hash || !data?.auth_date || !data?.id || !botToken) {
        return { valid: false, reason: "missing_fields" };
    }

    // 1. Build alphabetized data_check_string from all fields except `hash`
    const entries = Object.entries(data)
        .filter(([k, v]) => k !== "hash" && v !== undefined && v !== null && v !== "")
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

    // 2. secret_key = SHA256(bot_token)
    const secretKey = createHash("sha256").update(botToken).digest();

    // 3. expected = HMAC-SHA256(secret_key, data_check_string)
    const expected = createHmac("sha256", secretKey).update(dataCheckString).digest();

    let provided: Buffer;
    try {
        provided = Buffer.from(String(data.hash), "hex");
    } catch {
        return { valid: false, reason: "bad_hash" };
    }
    if (provided.length !== expected.length) {
        return { valid: false, reason: "bad_hash" };
    }
    if (!timingSafeEqual(provided, expected)) {
        return { valid: false, reason: "bad_hash" };
    }

    // 4. Freshness — auth_date in unix seconds, must be within window
    const authDate = Number(data.auth_date);
    const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
    if (ageSeconds > maxAgeSeconds || ageSeconds < -300) {
        return { valid: false, reason: "stale" };
    }

    return { valid: true };
}
