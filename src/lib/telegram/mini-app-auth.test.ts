/**
 * Unit tests for `verifyInitData`.
 *
 * Strategy: build authentic `initData` payloads from scratch via a co-located
 * `signInitData` helper that mirrors the algorithm `verifyInitData` is meant
 * to validate, then exercise:
 *
 *   - Property 1 — tampered hashes are rejected (`bad_signature`).
 *   - Property 2 — payloads older than `maxAgeSeconds` are rejected
 *     (`stale_auth_date`).
 *   - Property 3 — fresh, well-signed payloads are accepted and the parsed
 *     `authDate` round-trips.
 *   - Algorithm pin — a payload signed with the Login Widget formula
 *     (`SHA256(botToken)` as the secret) is rejected as `bad_signature`.
 *   - Clock-skew tolerance — `auth_date` 30s in the future is accepted, 90s
 *     in the future is rejected as `future_auth_date`.
 *
 * The helper is intentionally minimal — it sorts `key=value` pairs of the
 * raw values supplied by the caller, derives the WebApp secret key, and
 * appends a `hash` field. It does NOT URL-encode anything: callers pass
 * already-decoded strings, the helper joins them with `\n`, and signs.
 * `URLSearchParams.toString()` then percent-encodes when serialising. This
 * matches what a real Telegram client emits and what `verifyInitData` reads
 * back through the iterator.
 */
import { fc, fcAssert } from "@/test/property/fc-config";
import { Buffer } from "node:buffer";
import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyInitData } from "./mini-app-auth";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const BOT_TOKEN = "1234567890:TEST_BOT_TOKEN_FOR_VITEST";

/**
 * Build a signed `initData` query string from a record of params.
 *
 *  - `params` MUST NOT contain a `hash` key (added by the helper).
 *  - Values are taken verbatim — no escaping. The data-check string is built
 *    from sorted `key=value` lines joined by `\n` over the raw values, which
 *    is what `verifyInitData` expects after `URLSearchParams` decodes them.
 *
 * The returned string is suitable for direct consumption by `verifyInitData`
 * (i.e. it is URL-encoded via `URLSearchParams.toString()`).
 */
function signInitData(
    params: Record<string, string>,
    botToken: string,
    /**
     * Optional override for the secret-key derivation. The default is the
     * documented Mini-App formula, `HMAC_SHA256(key="WebAppData", msg=botToken)`.
     * Tests that pin the algorithm pass a Login-Widget-style derivation here.
     */
    deriveSecret: (botToken: string) => Buffer = (token) =>
        createHmac("sha256", "WebAppData").update(token).digest()
): string {
    if ("hash" in params) {
        throw new Error("signInitData: do not pre-supply a `hash` parameter");
    }
    const lines = Object.entries(params)
        .map(([k, v]) => `${k}=${v}`)
        .sort();
    const dataCheckString = lines.join("\n");
    const secretKey = deriveSecret(botToken);
    const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

    const out = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) out.append(k, v);
    out.append("hash", hash);
    return out.toString();
}

/** Default `auth_date` used by tests that pin freshness explicitly. */
const FIXED_AUTH_DATE = 1_700_000_000; // 2023-11-14T22:13:20Z
const FIXED_NOW = new Date(FIXED_AUTH_DATE * 1000 + 30_000); // +30s

// ---------------------------------------------------------------------------
// Helper sanity check — guards Property 3 below from a self-broken helper.
// ---------------------------------------------------------------------------

describe("signInitData (test helper)", () => {
    it("produces a hash that `verifyInitData` accepts", () => {
        const initData = signInitData(
            {
                auth_date: String(FIXED_AUTH_DATE),
                user: JSON.stringify({ id: 1, first_name: "Sanity" }),
            },
            BOT_TOKEN
        );
        const result = verifyInitData(initData, BOT_TOKEN, { now: FIXED_NOW });
        expect(result.ok).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Property 1 — tampered hashes are rejected.
// ---------------------------------------------------------------------------

describe("verifyInitData — Property 1: tampered `hash` is rejected", () => {
    /** Validates: Requirements 3.4, 3.6 (Property 1). */
    it("rejects any single-hex-character mutation of the signed hash", () => {
        fcAssert(
            fc.property(
                // Build a small, well-formed param set. Keys avoid `hash`,
                // `auth_date`, and any other reserved field; values are bounded
                // in length so the test stays fast. The empty-array case is
                // handled by always appending a `user` field below.
                fc.array(
                    fc.tuple(
                        fc
                            .string({ minLength: 1, maxLength: 16 })
                            .filter(
                                (s) =>
                                    !s.includes("=") &&
                                    !s.includes("&") &&
                                    !s.includes("\n") &&
                                    s !== "hash" &&
                                    s !== "auth_date" &&
                                    s !== "user"
                            ),
                        fc.string({ maxLength: 64 }).filter((s) => !s.includes("\n"))
                    ),
                    { maxLength: 6 }
                ),
                // Index of the hex character to flip and the replacement.
                fc.nat({ max: 63 }),
                fc.constantFrom(
                    "0",
                    "1",
                    "2",
                    "3",
                    "4",
                    "5",
                    "6",
                    "7",
                    "8",
                    "9",
                    "a",
                    "b",
                    "c",
                    "d",
                    "e",
                    "f"
                ),
                (extraPairs, mutateIdx, replacement) => {
                    // Deduplicate keys — `URLSearchParams` would otherwise emit
                    // multiple entries with the same key, which sort differently
                    // than the helper's pre-sorted lines.
                    const seen = new Set<string>();
                    const params: Record<string, string> = {
                        auth_date: String(FIXED_AUTH_DATE),
                        user: JSON.stringify({ id: 42, first_name: "T" }),
                    };
                    for (const [k, v] of extraPairs) {
                        if (seen.has(k)) continue;
                        seen.add(k);
                        params[k] = v;
                    }

                    const initData = signInitData(params, BOT_TOKEN);
                    const sp = new URLSearchParams(initData);
                    const originalHash = sp.get("hash") as string;

                    // Replace the chosen hex char with a *different* hex char
                    // so we always actually mutate.
                    const idx = mutateIdx % originalHash.length;
                    const before = originalHash.slice(0, idx);
                    const after = originalHash.slice(idx + 1);
                    const original = originalHash[idx];
                    const next =
                        replacement === original
                            ? // Pick a guaranteed-different hex char.
                              original === "f"
                                ? "0"
                                : "f"
                            : replacement;
                    const tampered = `${before}${next}${after}`;
                    expect(tampered).not.toBe(originalHash);

                    sp.set("hash", tampered);
                    const result = verifyInitData(sp.toString(), BOT_TOKEN, {
                        now: FIXED_NOW,
                    });
                    expect(result).toEqual({
                        ok: false,
                        reason: "bad_signature",
                    });
                }
            ),
            { numRuns: 50 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 2 — stale `auth_date` is rejected.
// ---------------------------------------------------------------------------

describe("verifyInitData — Property 2: stale `auth_date` is rejected", () => {
    /** Validates: Requirements 3.5 (Property 2). */
    it("rejects any payload whose age exceeds maxAgeSeconds", () => {
        fcAssert(
            fc.property(
                // `now` somewhere in the recent-history window so we don't
                // overflow Number → Date conversion.
                fc.integer({ min: 1_000_000, max: 2_000_000_000 }),
                // `maxAgeSeconds` between 1 and 30 days.
                fc.integer({ min: 1, max: 30 * 86_400 }),
                // How many seconds *past* the freshness window the payload is.
                fc.integer({ min: 1, max: 365 * 86_400 }),
                (nowSeconds, maxAgeSeconds, secondsPastWindow) => {
                    const now = new Date(nowSeconds * 1000);
                    const authDate = nowSeconds - maxAgeSeconds - secondsPastWindow;
                    const initData = signInitData(
                        {
                            auth_date: String(authDate),
                            user: JSON.stringify({ id: 1 }),
                        },
                        BOT_TOKEN
                    );
                    const result = verifyInitData(initData, BOT_TOKEN, {
                        now,
                        maxAgeSeconds,
                    });
                    expect(result).toEqual({
                        ok: false,
                        reason: "stale_auth_date",
                    });
                }
            ),
            { numRuns: 50 }
        );
    });
});

// ---------------------------------------------------------------------------
// Property 3 — fresh, well-signed payloads are accepted and round-trip.
// ---------------------------------------------------------------------------

describe("verifyInitData — Property 3: fresh payloads are accepted", () => {
    /** Validates: Requirements 3.1, 3.2, 3.7 (Property 3). */
    it("returns ok and round-trips authDate for a freshly signed payload", () => {
        fcAssert(
            fc.property(
                fc.integer({ min: 1_000_000_000, max: 2_000_000_000 }),
                fc.integer({ min: 0, max: 86_399 }),
                fc.integer({ min: 1, max: 1_000_000 }),
                (authDate, ageInsideWindow, userId) => {
                    const now = new Date((authDate + ageInsideWindow) * 1000);
                    const initData = signInitData(
                        {
                            auth_date: String(authDate),
                            user: JSON.stringify({
                                id: userId,
                                first_name: "P3",
                            }),
                            query_id: "AAEC",
                        },
                        BOT_TOKEN
                    );
                    const result = verifyInitData(initData, BOT_TOKEN, {
                        now,
                        maxAgeSeconds: 86_400,
                    });
                    expect(result.ok).toBe(true);
                    if (result.ok) {
                        expect(result.data.authDate).toBe(authDate);
                        expect(result.data.user?.id).toBe(userId);
                        expect(result.data.queryId).toBe("AAEC");
                    }
                }
            ),
            { numRuns: 50 }
        );
    });
});

// ---------------------------------------------------------------------------
// Algorithm pin — Login-Widget-formula payloads are rejected.
// ---------------------------------------------------------------------------

describe("verifyInitData — algorithm pin", () => {
    /** Validates: Requirements 3.3 (Property 1 algorithm choice). */
    it("rejects payloads signed with the Login Widget formula", () => {
        // Login Widget derives the secret as SHA256(botToken) directly, NOT
        // HMAC_SHA256("WebAppData", botToken). A payload that round-trips
        // through that algorithm MUST be rejected by the WebApp verifier.
        const loginWidgetSecret = (token: string) => createHash("sha256").update(token).digest();

        const initData = signInitData(
            {
                auth_date: String(FIXED_AUTH_DATE),
                user: JSON.stringify({ id: 1, first_name: "LoginWidget" }),
            },
            BOT_TOKEN,
            loginWidgetSecret
        );
        const result = verifyInitData(initData, BOT_TOKEN, { now: FIXED_NOW });
        expect(result).toEqual({ ok: false, reason: "bad_signature" });
    });
});

// ---------------------------------------------------------------------------
// Clock-skew tolerance — small future drifts are accepted.
// ---------------------------------------------------------------------------

describe("verifyInitData — clock-skew tolerance", () => {
    /** Validates: Requirements 3.6 (future_auth_date). */
    it("accepts an auth_date 30 seconds in the future", () => {
        const authDate = FIXED_AUTH_DATE;
        const now = new Date((authDate - 30) * 1000); // server is 30s behind
        const initData = signInitData(
            {
                auth_date: String(authDate),
                user: JSON.stringify({ id: 1 }),
            },
            BOT_TOKEN
        );
        const result = verifyInitData(initData, BOT_TOKEN, { now });
        expect(result.ok).toBe(true);
    });

    /** Validates: Requirements 3.6 (future_auth_date). */
    it("rejects an auth_date 90 seconds in the future", () => {
        const authDate = FIXED_AUTH_DATE;
        const now = new Date((authDate - 90) * 1000); // server is 90s behind
        const initData = signInitData(
            {
                auth_date: String(authDate),
                user: JSON.stringify({ id: 1 }),
            },
            BOT_TOKEN
        );
        const result = verifyInitData(initData, BOT_TOKEN, { now });
        expect(result).toEqual({ ok: false, reason: "future_auth_date" });
    });
});

// ---------------------------------------------------------------------------
// Smoke tests for the negative-path reasons not covered above. These pin the
// reason strings so a refactor cannot silently change the contract surface.
// ---------------------------------------------------------------------------

describe("verifyInitData — negative reason codes", () => {
    /** Validates: Requirements 3.1 (missing_hash). */
    it("returns missing_hash when the hash field is absent", () => {
        const initData = "auth_date=" + FIXED_AUTH_DATE + "&user=%7B%22id%22%3A1%7D";
        const result = verifyInitData(initData, BOT_TOKEN, { now: FIXED_NOW });
        expect(result).toEqual({ ok: false, reason: "missing_hash" });
    });

    /** Validates: Requirements 3.1 (missing_auth_date). */
    it("returns missing_auth_date when the auth_date field is absent", () => {
        // Sign a payload that intentionally omits `auth_date` so the early
        // return fires before the signature comparison.
        const lines = ["user=" + JSON.stringify({ id: 1 })].sort();
        const dataCheckString = lines.join("\n");
        const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
        const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
        const sp = new URLSearchParams();
        sp.append("user", JSON.stringify({ id: 1 }));
        sp.append("hash", hash);
        const result = verifyInitData(sp.toString(), BOT_TOKEN, {
            now: FIXED_NOW,
        });
        expect(result).toEqual({ ok: false, reason: "missing_auth_date" });
    });

    it("does not throw when the receivedHash length differs from expected", () => {
        // A short hex string (1 byte) deliberately makes `Buffer.from` produce
        // a length that cannot match the 32-byte HMAC output. The verifier
        // must report `bad_signature` rather than crash inside `timingSafeEqual`.
        const sp = new URLSearchParams();
        sp.append("auth_date", String(FIXED_AUTH_DATE));
        sp.append("user", JSON.stringify({ id: 1 }));
        sp.append("hash", "ab"); // 1 byte
        const result = verifyInitData(sp.toString(), BOT_TOKEN, {
            now: FIXED_NOW,
        });
        expect(result).toEqual({ ok: false, reason: "bad_signature" });
    });
});
