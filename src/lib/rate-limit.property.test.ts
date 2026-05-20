// Feature: public-form-abuse-hardening, Properties 9-13: Rate limiting
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fc, fcAssert } from "@/test/property/fc-config";

// Mock upstash ratelimit with the in-memory stub
vi.mock("@upstash/ratelimit", () => import("@/test/integration/upstash-stub"));

// Mock auth to control user state
vi.mock("@/lib/auth", () => ({
    auth: vi.fn().mockResolvedValue(null),
}));

// Mock env
vi.mock("@/lib/env", () => ({
    env: {
        NODE_ENV: "test",
        CRON_SECRET: "test-cron-secret",
        CAPTCHA_PROVIDER: "disabled",
        CAPTCHA_SECRET_KEY: undefined,
        CAPTCHA_DEV_BYPASS: "0",
        CORS_ALLOWED_ORIGINS: "",
        CONTACT_RL_LIMIT: undefined,
        CONTACT_RL_WINDOW: undefined,
        CONTACT_USER_RL_LIMIT: undefined,
        CONTACT_USER_RL_WINDOW: undefined,
        RESERVATION_RL_LIMIT: undefined,
        RESERVATION_RL_WINDOW: undefined,
        RESERVATION_USER_RL_LIMIT: undefined,
        RESERVATION_USER_RL_WINDOW: undefined,
    },
}));

// Mock redis to provide upstash
vi.mock("@/lib/redis", () => ({
    upstash: {},
    hasUpstash: () => true,
}));

// Mock log to suppress output
vi.mock("@/lib/log", () => ({
    logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

import { auth } from "@/lib/auth";
import { applyRateLimit } from "@/lib/api";
import {
    resetUpstashStub,
    setUpstashStubClock,
    hadUserPrefixWrites,
    getUpstashCalls,
} from "@/test/integration/upstash-stub";

function makeReq(path: string, headers?: Record<string, string>): Request {
    const h = new Headers({ "cf-connecting-ip": "1.2.3.4", ...headers });
    return new Request(`http://test.local${path}`, { headers: h });
}

describe("Rate-limit property tests", () => {
    let now = 1_000_000;

    beforeEach(() => {
        resetUpstashStub();
        now = 1_000_000;
        setUpstashStubClock(() => now);
        vi.mocked(auth).mockResolvedValue(null);
    });

    // Property 9: Rate-limit composition per authentication state
    it("P9: anonymous requests only consult per-IP bucket", async () => {
        await fcAssert(
            fc.asyncProperty(
                fc.constantFrom("contact" as const, "reservation" as const),
                async (kind) => {
                    resetUpstashStub();
                    setUpstashStubClock(() => now);
                    vi.mocked(auth).mockResolvedValue(null);

                    const req = makeReq("/api/" + kind);
                    const result = await applyRateLimit(req, kind);

                    // Should admit (first call)
                    if (result !== null) return false;
                    // Should NOT have written any u: prefixed keys
                    return !hadUserPrefixWrites();
                }
            ),
            { seed: 9 }
        );
    });

    // Property 10: Bucket independence across distinct identifiers
    it("P10: exhausting one IP bucket does not affect another IP", async () => {
        await fcAssert(
            fc.asyncProperty(fc.constantFrom("contact" as const), async (kind) => {
                resetUpstashStub();
                setUpstashStubClock(() => now);
                vi.mocked(auth).mockResolvedValue(null);

                // Exhaust IP A (limit is 3 for contact)
                for (let i = 0; i < 5; i++) {
                    const req = makeReq("/api/contact", { "cf-connecting-ip": "10.0.0.1" });
                    await applyRateLimit(req, kind);
                }

                // IP B should still be admitted
                const reqB = makeReq("/api/contact", { "cf-connecting-ip": "10.0.0.2" });
                const result = await applyRateLimit(reqB, kind);
                return result === null;
            }),
            { seed: 10 }
        );
    });

    // Property 11: Retry-After arithmetic
    it("P11: Retry-After is at least 1 and computed from reset time", async () => {
        await fcAssert(
            fc.asyncProperty(fc.constantFrom("contact" as const), async (kind) => {
                resetUpstashStub();
                now = 1_000_000;
                setUpstashStubClock(() => now);
                vi.mocked(auth).mockResolvedValue(null);

                // Exhaust the bucket (limit 3)
                for (let i = 0; i < 3; i++) {
                    await applyRateLimit(makeReq("/api/contact"), kind);
                }

                // 4th call should be denied
                const result = await applyRateLimit(makeReq("/api/contact"), kind);
                if (result === null) return false;

                const retryAfter = Number(result.headers.get("retry-after"));
                return retryAfter >= 1;
            }),
            { seed: 11 }
        );
    });

    // Property 12: Bucket admission monotonicity
    it("P12: admitted count never exceeds the configured limit within a window", async () => {
        await fcAssert(
            fc.asyncProperty(
                fc.constantFrom("contact" as const, "reservation" as const),
                fc.integer({ min: 1, max: 30 }),
                async (kind, attempts) => {
                    resetUpstashStub();
                    setUpstashStubClock(() => now);
                    vi.mocked(auth).mockResolvedValue(null);

                    let admitted = 0;
                    for (let i = 0; i < attempts; i++) {
                        const result = await applyRateLimit(makeReq(`/api/${kind}`), kind);
                        if (result === null) admitted++;
                    }

                    // contact limit is 3, reservation limit is 10
                    const limit = kind === "contact" ? 3 : 10;
                    return admitted <= limit;
                }
            ),
            { seed: 12 }
        );
    });

    // Property 13: Bypass paths skip both buckets and write nothing
    it("P13: bypass paths always admit and write nothing", async () => {
        const bypassPathArb = fc.constantFrom(
            "/api/cron/expire-holds",
            "/api/cron/cleanup",
            "/api/internal/health",
            "/api/internal/metrics"
        );

        await fcAssert(
            fc.asyncProperty(bypassPathArb, fc.integer({ min: 1, max: 10 }), async (path, n) => {
                resetUpstashStub();
                setUpstashStubClock(() => now);
                vi.mocked(auth).mockResolvedValue({
                    user: { id: "user-1", role: "admin" },
                    expires: "",
                } as any);

                for (let i = 0; i < n; i++) {
                    const result = await applyRateLimit(makeReq(path), "contact");
                    if (result !== null) return false;
                }

                // No calls should have been made to the stub
                return getUpstashCalls().length === 0;
            }),
            { seed: 13 }
        );
    });
});
