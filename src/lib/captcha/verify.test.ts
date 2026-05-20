import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyCaptcha, interpretProviderResponse, ERROR_CODE_MAP } from "@/lib/captcha/verify";

// Mock the env module so we can control CAPTCHA_PROVIDER etc.
vi.mock("@/lib/env", () => ({
    env: {
        NODE_ENV: "test",
        CAPTCHA_PROVIDER: "turnstile",
        CAPTCHA_SECRET_KEY: "test-secret-key-value",
        CAPTCHA_VERIFY_TIMEOUT_MS: undefined,
        CAPTCHA_DEV_BYPASS: "0",
        CAPTCHA_EXPECTED_HOSTNAME: undefined,
    },
}));

import { env } from "@/lib/env";

describe("verifyCaptcha", () => {
    beforeEach(() => {
        (env as any).CAPTCHA_PROVIDER = "turnstile";
        (env as any).CAPTCHA_SECRET_KEY = "test-secret-key-value";
        (env as any).CAPTCHA_VERIFY_TIMEOUT_MS = undefined;
        (env as any).CAPTCHA_DEV_BYPASS = "0";
    });

    it("returns verifier_disabled when CAPTCHA_PROVIDER is disabled", async () => {
        (env as any).CAPTCHA_PROVIDER = "disabled";
        const result = await verifyCaptcha("a".repeat(30));
        expect(result).toEqual({ ok: false, reason: "verifier_disabled" });
    });

    it("returns missing_token when token is undefined", async () => {
        const result = await verifyCaptcha(undefined);
        expect(result).toEqual({ ok: false, reason: "missing_token" });
    });

    it("returns missing_token when token is empty", async () => {
        const result = await verifyCaptcha("");
        expect(result).toEqual({ ok: false, reason: "missing_token" });
    });

    it("returns missing_token when token is shorter than 20 chars", async () => {
        const result = await verifyCaptcha("short-token-19ch");
        expect(result).toEqual({ ok: false, reason: "missing_token" });
    });

    it("returns verifier_disabled when secret is empty", async () => {
        (env as any).CAPTCHA_SECRET_KEY = "";
        const result = await verifyCaptcha("a".repeat(30));
        expect(result).toEqual({ ok: false, reason: "verifier_disabled" });
    });

    it("returns ok:true on successful provider response", async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true, hostname: "piercer.kzn", action: "contact" }),
        });
        const result = await verifyCaptcha("a".repeat(30), { fetchImpl });
        expect(result).toEqual({
            ok: true,
            provider: "turnstile",
            hostname: "piercer.kzn",
            action: "contact",
        });
    });

    it("sends correct request body shape", async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });
        const token = "a".repeat(30);
        await verifyCaptcha(token, { fetchImpl, remoteIp: "1.2.3.4" });

        expect(fetchImpl).toHaveBeenCalledTimes(1);
        const [url, init] = fetchImpl.mock.calls[0];
        expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
        expect(init.method).toBe("POST");
        const body = new URLSearchParams(init.body);
        expect(body.get("secret")).toBe("test-secret-key-value");
        expect(body.get("response")).toBe(token);
        expect(body.get("remoteip")).toBe("1.2.3.4");
    });

    it("omits remoteip when not provided", async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });
        await verifyCaptcha("a".repeat(30), { fetchImpl });
        const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
        expect(body.has("remoteip")).toBe(false);
    });

    it("returns provider_unavailable on non-ok response", async () => {
        const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 });
        const result = await verifyCaptcha("a".repeat(30), { fetchImpl });
        expect(result).toEqual({ ok: false, reason: "provider_unavailable" });
    });

    it("returns provider_unavailable on fetch throw", async () => {
        const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
        const result = await verifyCaptcha("a".repeat(30), { fetchImpl });
        expect(result).toEqual({ ok: false, reason: "provider_unavailable" });
    });

    it("returns provider_unavailable on JSON parse failure", async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => {
                throw new SyntaxError("bad json");
            },
        });
        const result = await verifyCaptcha("a".repeat(30), { fetchImpl });
        expect(result).toEqual({ ok: false, reason: "provider_unavailable" });
    });

    it("respects timeoutMs and aborts", async () => {
        vi.useFakeTimers();
        const fetchImpl = vi.fn().mockImplementation(
            (_url: string, init: { signal: AbortSignal }) =>
                new Promise((_, reject) => {
                    init.signal.addEventListener("abort", () =>
                        reject(new DOMException("aborted"))
                    );
                })
        );
        const promise = verifyCaptcha("a".repeat(30), { fetchImpl, timeoutMs: 100 });
        vi.advanceTimersByTime(101);
        const result = await promise;
        expect(result).toEqual({ ok: false, reason: "provider_unavailable" });
        vi.useRealTimers();
    });

    it("uses hcaptcha URL when provider is hcaptcha", async () => {
        (env as any).CAPTCHA_PROVIDER = "hcaptcha";
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true }),
        });
        await verifyCaptcha("a".repeat(30), { fetchImpl });
        expect(fetchImpl.mock.calls[0][0]).toBe("https://api.hcaptcha.com/siteverify");
    });
});

describe("interpretProviderResponse", () => {
    it("returns ok:true for success response", () => {
        const result = interpretProviderResponse(
            { success: true, hostname: "h", action: "a" },
            "turnstile"
        );
        expect(result).toEqual({ ok: true, provider: "turnstile", hostname: "h", action: "a" });
    });

    it("omits hostname/action when not strings", () => {
        const result = interpretProviderResponse(
            { success: true, hostname: 123, action: null },
            "hcaptcha"
        );
        expect(result).toEqual({
            ok: true,
            provider: "hcaptcha",
            hostname: undefined,
            action: undefined,
        });
    });

    it("returns invalid_token for null body", () => {
        expect(interpretProviderResponse(null, "turnstile")).toEqual({
            ok: false,
            reason: "invalid_token",
        });
    });

    it("returns invalid_token for non-object body", () => {
        expect(interpretProviderResponse("string", "turnstile")).toEqual({
            ok: false,
            reason: "invalid_token",
        });
    });

    it("maps known error codes per Table A", () => {
        for (const [code, reason] of Object.entries(ERROR_CODE_MAP)) {
            const result = interpretProviderResponse(
                { success: false, "error-codes": [code] },
                "turnstile"
            );
            expect(result).toEqual({ ok: false, reason });
        }
    });

    it("falls back to invalid_token for unknown error codes", () => {
        const result = interpretProviderResponse(
            { success: false, "error-codes": ["unknown-code"] },
            "turnstile"
        );
        expect(result).toEqual({ ok: false, reason: "invalid_token" });
    });

    it("falls back to invalid_token for empty error-codes", () => {
        const result = interpretProviderResponse(
            { success: false, "error-codes": [] },
            "turnstile"
        );
        expect(result).toEqual({ ok: false, reason: "invalid_token" });
    });

    it("falls back to invalid_token for missing error-codes", () => {
        const result = interpretProviderResponse({ success: false }, "turnstile");
        expect(result).toEqual({ ok: false, reason: "invalid_token" });
    });

    it("uses first string code from error-codes array", () => {
        const result = interpretProviderResponse(
            {
                success: false,
                "error-codes": [123, "timeout-or-duplicate", "invalid-input-response"],
            },
            "turnstile"
        );
        expect(result).toEqual({ ok: false, reason: "duplicate_token" });
    });
});
