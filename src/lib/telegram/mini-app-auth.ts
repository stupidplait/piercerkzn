/**
 * Telegram Mini-App `initData` HMAC verifier.
 *
 * Pure server-side module that validates the `initData` query string passed
 * by `window.Telegram.WebApp` against the bot token. No I/O, no DB, no
 * `next/*` imports — safe to consume from any RSC, route handler, or test.
 *
 * Algorithm (per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):
 *
 *     secretKey       = HMAC_SHA256(key = "WebAppData", message = botToken)
 *     dataCheckString = sorted "key=value" lines joined by "\n", excluding `hash`
 *     expectedHash    = HMAC_SHA256(key = secretKey, message = dataCheckString)
 *     verify          = timingSafeEqual(expectedHash, hex_decode(receivedHash))
 *
 * IMPORTANT — `"WebAppData"` is the documented constant for the **WebApp**
 * (a.k.a. Mini App) algorithm. This is **not** the same as the Telegram
 * **Login Widget** algorithm, which derives the secret as `SHA256(botToken)`
 * directly. Mixing the two is the most common implementation mistake — using
 * the Login Widget formula here causes every genuine WebApp payload to be
 * rejected, while accepting Login Widget payloads forged with the bot token.
 *
 * Freshness is enforced by `auth_date`: payloads older than `maxAgeSeconds`
 * (default 86 400 = 24 h) are rejected as `stale_auth_date`. We also reject
 * payloads whose `auth_date` is more than 60 seconds **in the future** as
 * `future_auth_date`, allowing a small backward clock-skew tolerance for
 * servers whose clock trails the Telegram client clock without compromising
 * freshness.
 *
 * Values used to build the data-check string come from the
 * `URLSearchParams` iterator, which URL-decodes percent-encoded characters.
 * Telegram's documented algorithm sorts the **decoded** `key=value` pairs,
 * so the iterator's values are exactly what we need (no extra decode step).
 *
 * Hash comparison runs over raw bytes via `crypto.timingSafeEqual` after a
 * length check — a length mismatch is reported as `bad_signature` rather
 * than thrown, since `timingSafeEqual` would otherwise raise.
 */
import "server-only";

import { Buffer } from "node:buffer";
import { createHmac, timingSafeEqual } from "node:crypto";

export type VerifyReason =
    | "missing_hash"
    | "missing_auth_date"
    | "stale_auth_date"
    | "future_auth_date"
    | "bad_signature"
    | "missing_user";

export interface TelegramUser {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
}

export interface ParsedInitData {
    authDate: number;
    user: TelegramUser | null;
    queryId: string | null;
    startParam: string | null;
}

export interface VerifyInitDataOptions {
    /** Reference time for freshness checks. Defaults to `new Date()`. */
    now?: Date;
    /** Maximum allowed age of `auth_date` in seconds. Defaults to 86 400 (24 h). */
    maxAgeSeconds?: number;
}

const DEFAULT_MAX_AGE_SECONDS = 86_400;
const FUTURE_SKEW_TOLERANCE_MS = 60_000;
const WEBAPP_SECRET_KEY_CONSTANT = "WebAppData";

/**
 * Validate a Telegram Mini-App `initData` payload against a bot token.
 *
 * @param initData The raw query string from `window.Telegram.WebApp.initData`.
 * @param botToken The bot token to derive the HMAC secret key from.
 * @param options  Optional `now` / `maxAgeSeconds` overrides for freshness.
 * @returns `{ ok: true, data }` on success, `{ ok: false, reason }` otherwise.
 */
export function verifyInitData(
    initData: string,
    botToken: string,
    options?: VerifyInitDataOptions
): { ok: true; data: ParsedInitData } | { ok: false; reason: VerifyReason } {
    const now = options?.now ?? new Date();
    const maxAgeSeconds = options?.maxAgeSeconds ?? DEFAULT_MAX_AGE_SECONDS;

    const params = new URLSearchParams(initData);

    const receivedHash = params.get("hash");
    if (!receivedHash) {
        return { ok: false, reason: "missing_hash" };
    }

    const authDateRaw = params.get("auth_date");
    if (!authDateRaw) {
        return { ok: false, reason: "missing_auth_date" };
    }

    const authDateSeconds = Number(authDateRaw);
    const ageMs = now.getTime() - authDateSeconds * 1000;
    if (ageMs > maxAgeSeconds * 1000) {
        return { ok: false, reason: "stale_auth_date" };
    }
    if (ageMs < -FUTURE_SKEW_TOLERANCE_MS) {
        return { ok: false, reason: "future_auth_date" };
    }

    // Build the data-check string from sorted key=value pairs (excluding `hash`).
    // URLSearchParams already URL-decodes values, which matches Telegram's spec.
    const pairs: string[] = [];
    for (const [key, value] of params.entries()) {
        if (key === "hash") continue;
        pairs.push(`${key}=${value}`);
    }
    pairs.sort();
    const dataCheckString = pairs.join("\n");

    const secretKey = createHmac("sha256", WEBAPP_SECRET_KEY_CONSTANT).update(botToken).digest();
    const expected = createHmac("sha256", secretKey).update(dataCheckString).digest();
    const received = Buffer.from(receivedHash, "hex");

    if (received.length !== expected.length) {
        return { ok: false, reason: "bad_signature" };
    }
    if (!timingSafeEqual(received, expected)) {
        return { ok: false, reason: "bad_signature" };
    }

    const userRaw = params.get("user");
    const user = userRaw ? safeJsonParse<TelegramUser>(userRaw) : null;

    return {
        ok: true,
        data: {
            authDate: authDateSeconds,
            user,
            queryId: params.get("query_id"),
            startParam: params.get("start_param"),
        },
    };
}

function safeJsonParse<T>(raw: string): T | null {
    try {
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}
