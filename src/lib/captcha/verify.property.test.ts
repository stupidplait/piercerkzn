// Feature: public-form-abuse-hardening, Properties 1-5: Captcha verification
import { describe, it, vi } from "vitest";
import { fc, fcAssert } from "@/test/property/fc-config";
import {
    verifyCaptcha,
    interpretProviderResponse,
    ERROR_CODE_MAP,
    type CaptchaProvider,
} from "@/lib/captcha/verify";

vi.mock("@/lib/env", () => ({
    env: {
        NODE_ENV: "test",
        CAPTCHA_PROVIDER: "turnstile",
        CAPTCHA_SECRET_KEY: "test-secret-key-value",
        CAPTCHA_VERIFY_TIMEOUT_MS: undefined,
        CAPTCHA_DEV_BYPASS: "0",
    },
}));

const providerArb = fc.constantFrom<CaptchaProvider>("hcaptcha", "turnstile");

describe("Captcha property tests", () => {
    // Property 1: Token-shape rejection short-circuits before fetch
    it("P1: tokens shorter than 20 chars return missing_token without calling fetch", async () => {
        const shortTokenArb = fc.option(fc.string({ maxLength: 19 }), { nil: undefined });

        await fcAssert(
            fc.asyncProperty(shortTokenArb, async (token) => {
                const fetchImpl = vi.fn();
                const result = await verifyCaptcha(token, { fetchImpl });
                return (
                    result.ok === false &&
                    result.reason === "missing_token" &&
                    fetchImpl.mock.calls.length === 0
                );
            }),
            { seed: 1 }
        );
    });

    // Property 2: Provider success response yields ok:true with passthrough fields
    it("P2: success response yields ok:true with string fields passed through", () => {
        const bodyArb = fc.record({
            success: fc.constant(true),
            hostname: fc.option(fc.oneof(fc.string(), fc.integer(), fc.constant(null)), {
                nil: undefined,
            }),
            action: fc.option(fc.oneof(fc.string(), fc.integer(), fc.constant(null)), {
                nil: undefined,
            }),
            challenge_ts: fc.option(fc.string(), { nil: undefined }),
        });

        fcAssert(
            fc.property(bodyArb, providerArb, (body, provider) => {
                const result = interpretProviderResponse(body, provider);
                if (!result.ok) return false;
                if (result.provider !== provider) return false;
                // hostname propagates iff typeof === "string"
                const expectHostname =
                    typeof body.hostname === "string" ? body.hostname : undefined;
                if (result.hostname !== expectHostname) return false;
                // action propagates iff typeof === "string"
                const expectAction = typeof body.action === "string" ? body.action : undefined;
                if (result.action !== expectAction) return false;
                return true;
            }),
            { seed: 2 }
        );
    });

    // Property 3: Provider error-codes map per Table A
    it("P3: error-codes map to correct reasons per Table A", () => {
        const knownCodes = Object.keys(ERROR_CODE_MAP);
        const codesArb = fc.array(
            fc.oneof(fc.constantFrom(...knownCodes), fc.string({ minLength: 1 })),
            { minLength: 0, maxLength: 5 }
        );

        fcAssert(
            fc.property(codesArb, providerArb, (codes, provider) => {
                const body = { success: false, "error-codes": codes };
                const result = interpretProviderResponse(body, provider);
                if (result.ok) return false;

                const firstString = codes.find((c): c is string => typeof c === "string");
                if (!firstString) {
                    return result.reason === "invalid_token";
                }
                const expected = ERROR_CODE_MAP[firstString] ?? "invalid_token";
                return result.reason === expected;
            }),
            { seed: 3 }
        );
    });

    // Property 4: Network and parse failure modes resolve to provider_unavailable
    it("P4: all failure modes resolve to provider_unavailable", async () => {
        const failureModeArb = fc.constantFrom("throw", "non-ok", "bad-json", "abort");

        await fcAssert(
            fc.asyncProperty(failureModeArb, async (mode) => {
                let fetchImpl: typeof fetch;
                switch (mode) {
                    case "throw":
                        fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
                        break;
                    case "non-ok":
                        fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
                        break;
                    case "bad-json":
                        fetchImpl = vi.fn().mockResolvedValue({
                            ok: true,
                            json: async () => {
                                throw new SyntaxError("bad");
                            },
                        });
                        break;
                    case "abort":
                        fetchImpl = vi.fn().mockImplementation(
                            (_url: string, init: { signal: AbortSignal }) =>
                                new Promise((_, reject) => {
                                    if (init.signal.aborted) {
                                        reject(new DOMException("aborted"));
                                        return;
                                    }
                                    init.signal.addEventListener("abort", () =>
                                        reject(new DOMException("aborted"))
                                    );
                                })
                        );
                        break;
                }
                const result = await verifyCaptcha("a".repeat(30), {
                    fetchImpl: fetchImpl!,
                    timeoutMs: 50,
                });
                return result.ok === false && result.reason === "provider_unavailable";
            }),
            { seed: 4 }
        );
    });

    // Property 5: Verify-call body round-trip
    it("P5: request body encodes and decodes correctly", async () => {
        const bodyArb = fc.record({
            secret: fc.string({ minLength: 1 }),
            response: fc.string({ minLength: 20 }),
            remoteip: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
        });

        await fcAssert(
            fc.asyncProperty(bodyArb, async ({ secret, response, remoteip }) => {
                let capturedBody = "";
                const fetchImpl = vi
                    .fn()
                    .mockImplementation(async (_url: string, init: { body: string }) => {
                        capturedBody = init.body;
                        return { ok: true, json: async () => ({ success: true }) };
                    });

                // We need to mock env for this specific test
                const { env } = await import("@/lib/env");
                (env as any).CAPTCHA_SECRET_KEY = secret;

                await verifyCaptcha(response, {
                    fetchImpl,
                    remoteIp: remoteip,
                });

                if (fetchImpl.mock.calls.length === 0) return true; // short-circuited

                const decoded = Object.fromEntries(new URLSearchParams(capturedBody));
                if (decoded.secret !== secret) return false;
                if (decoded.response !== response) return false;
                if (remoteip !== undefined) {
                    if (decoded.remoteip !== remoteip) return false;
                } else {
                    if ("remoteip" in decoded) return false;
                }
                return true;
            }),
            { seed: 5 }
        );
    });
});
