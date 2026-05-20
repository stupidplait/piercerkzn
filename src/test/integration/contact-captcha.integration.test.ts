import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { makeTestTag, cleanupTaggedRows, readResponse } from "@/test/integration/helpers";

// Mock captcha verifier
const mockVerifyCaptcha = vi.fn();
vi.mock("@/lib/captcha/verify", () => ({
    verifyCaptcha: (...args: unknown[]) => mockVerifyCaptcha(...args),
}));

// Mock env
vi.mock("@/lib/env", async (importOriginal) => {
    const orig = await importOriginal<typeof import("@/lib/env")>();
    return {
        ...orig,
        env: {
            ...orig.env,
            NODE_ENV: "test",
            CAPTCHA_PROVIDER: "turnstile",
            CAPTCHA_SECRET_KEY: "test-key",
            CAPTCHA_DEV_BYPASS: "0",
            CAPTCHA_EXPECTED_HOSTNAME: undefined,
            CORS_ALLOWED_ORIGINS: "",
        },
    };
});

// Mock rate-limit to always admit
vi.mock("@/lib/rate-limit", async (importOriginal) => {
    const orig = await importOriginal<typeof import("@/lib/rate-limit")>();
    return {
        ...orig,
        check: vi.fn().mockResolvedValue({ success: true, limit: 100, remaining: 99, reset: 0 }),
        isBypassPath: () => false,
    };
});

// Mock auth (unauthenticated)
vi.mock("@/lib/auth", () => ({
    auth: vi.fn().mockResolvedValue(null),
}));

// Mock posthog
const mockCapture = vi.fn();
vi.mock("@/lib/posthog", () => ({
    capture: (...args: unknown[]) => mockCapture(...args),
}));

// Mock log
const mockLogSecurityEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/log", () => ({
    logSecurityEvent: (...args: unknown[]) => mockLogSecurityEvent(...args),
}));

import { POST } from "@/app/api/contact/route";
import { env } from "@/lib/env";

const tag = makeTestTag("contact-captcha");

afterAll(async () => {
    await cleanupTaggedRows(tag);
});

function buildContactRequest(overrides: Record<string, unknown> = {}): Request {
    return new Request("http://test.local/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": "1.2.3.4" },
        body: JSON.stringify({
            name: "Test User",
            email: `${tag}@test.local`,
            message: "This is a test message that is long enough to pass validation",
            captchaToken: "a".repeat(30),
            ...overrides,
        }),
    });
}

describe("POST /api/contact - captcha gate", () => {
    beforeEach(() => {
        mockVerifyCaptcha.mockReset();
        mockCapture.mockReset();
        mockLogSecurityEvent.mockReset();
        (env as any).CAPTCHA_EXPECTED_HOSTNAME = undefined;
    });

    // Property 6: Persistence fires iff verifier returns ok:true
    it("P6: creates inquiry and fires capture when captcha ok", async () => {
        mockVerifyCaptcha.mockResolvedValue({
            ok: true,
            provider: "turnstile",
            hostname: "piercer.kzn",
        });

        const res = await POST(buildContactRequest());
        const { status, json } = await readResponse(res);

        expect(status).toBe(201);
        expect(json).toHaveProperty("inquiry");
        expect(mockCapture).toHaveBeenCalledTimes(1);
    });

    it("P6: does NOT create inquiry when captcha fails", async () => {
        mockVerifyCaptcha.mockResolvedValue({ ok: false, reason: "invalid_token" });
        mockCapture.mockReset();

        const res = await POST(buildContactRequest());
        const { status } = await readResponse(res);

        expect(status).toBe(422);
        expect(mockCapture).not.toHaveBeenCalled();
    });

    // Property 7: Captcha rejection produces stable wire format
    it("P7: rejection returns canonical 422 envelope", async () => {
        mockVerifyCaptcha.mockResolvedValue({ ok: false, reason: "expired_token" });

        const res = await POST(buildContactRequest());
        const { status, json } = await readResponse<any>(res);

        expect(status).toBe(422);
        expect(json).toEqual({
            error: "validation_error",
            message:
                "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0443 \u0444\u043e\u0440\u043c\u044b.",
            fields: {
                captchaToken:
                    "\u041f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043d\u0435 \u043f\u0440\u043e\u0439\u0434\u0435\u043d\u0430, \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0443 \u0438 \u043f\u043e\u043f\u0440\u043e\u0431\u0443\u0439\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.",
            },
        });
    });

    it("P7: rejection logs captcha_rejected with prefix only", async () => {
        const token = "abcdefgh" + "x".repeat(22);
        mockVerifyCaptcha.mockResolvedValue({ ok: false, reason: "duplicate_token" });

        await POST(buildContactRequest({ captchaToken: token }));

        expect(mockLogSecurityEvent).toHaveBeenCalledWith(
            "captcha_rejected",
            expect.objectContaining({
                route: "/api/contact",
                reason: "duplicate_token",
                captchaTokenPrefix: "abcdefgh",
            })
        );
    });

    // Property 8: Hostname check
    it("P8: admits when CAPTCHA_EXPECTED_HOSTNAME is unset", async () => {
        mockVerifyCaptcha.mockResolvedValue({
            ok: true,
            provider: "turnstile",
            hostname: "anything.com",
        });

        const res = await POST(buildContactRequest());
        expect(res.status).toBe(201);
    });

    it("P8: admits when hostname matches expected", async () => {
        (env as any).CAPTCHA_EXPECTED_HOSTNAME = "piercer.kzn";
        mockVerifyCaptcha.mockResolvedValue({
            ok: true,
            provider: "turnstile",
            hostname: "piercer.kzn",
        });

        const res = await POST(buildContactRequest());
        expect(res.status).toBe(201);
    });

    it("P8: rejects when hostname does not match expected", async () => {
        (env as any).CAPTCHA_EXPECTED_HOSTNAME = "piercer.kzn";
        mockVerifyCaptcha.mockResolvedValue({
            ok: true,
            provider: "turnstile",
            hostname: "evil.com",
        });

        const res = await POST(buildContactRequest());
        const { status } = await readResponse(res);
        expect(status).toBe(422);

        expect(mockLogSecurityEvent).toHaveBeenCalledWith(
            "captcha_rejected",
            expect.objectContaining({ reason: "hostname_mismatch" })
        );
    });
});
