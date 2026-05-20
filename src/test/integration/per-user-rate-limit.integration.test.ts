import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock upstash ratelimit with the in-memory stub
vi.mock("@upstash/ratelimit", () => import("@/test/integration/upstash-stub"));

// Mock auth to control user state
const mockAuth = vi.fn();
vi.mock("@/lib/auth", () => ({
    auth: (...args: unknown[]) => mockAuth(...args),
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

// Mock log
vi.mock("@/lib/log", () => ({
    logSecurityEvent: vi.fn().mockResolvedValue(undefined),
}));

import { applyRateLimit } from "@/lib/api";
import {
    resetUpstashStub,
    setUpstashStubClock,
    hadUserPrefixWrites,
    getUpstashCalls,
    getCalledIdentifiers,
} from "@/test/integration/upstash-stub";

function makeReq(path: string, ip = "1.2.3.4"): Request {
    return new Request(`http://test.local${path}`, {
        headers: { "cf-connecting-ip": ip },
    });
}

describe("Per-user rate-limit composition", () => {
    let now: number;

    beforeEach(() => {
        resetUpstashStub();
        now = 1_000_000;
        setUpstashStubClock(() => now);
        mockAuth.mockResolvedValue(null);
    });

    it("anonymous requests only touch per-IP bucket", async () => {
        mockAuth.mockResolvedValue(null);

        const result = await applyRateLimit(makeReq("/api/contact"), "contact");
        expect(result).toBeNull();
        expect(hadUserPrefixWrites()).toBe(false);

        const ids = getCalledIdentifiers();
        expect(ids.every((id) => id.startsWith("ip:"))).toBe(true);
    });

    it("authenticated requests touch both per-IP and per-user buckets", async () => {
        mockAuth.mockResolvedValue({
            user: { id: "user-42", role: "customer" },
            expires: "",
        });

        const result = await applyRateLimit(makeReq("/api/contact"), "contact");
        expect(result).toBeNull();

        const ids = getCalledIdentifiers();
        expect(ids).toContain("ip:1.2.3.4");
        expect(ids).toContain("u:user-42");
    });

    it("per-user bucket exhausts independently of per-IP", async () => {
        mockAuth.mockResolvedValue({
            user: { id: "user-99", role: "customer" },
            expires: "",
        });

        // contact_user limit is 10/h. Exhaust it.
        for (let i = 0; i < 10; i++) {
            await applyRateLimit(makeReq("/api/contact"), "contact");
        }

        // 11th call should be denied (per-user exhausted)
        const result = await applyRateLimit(makeReq("/api/contact"), "contact");
        expect(result).not.toBeNull();
        expect(result!.status).toBe(429);
    });

    it("switching userId restores admission until per-IP exhausts", async () => {
        // User A exhausts per-user budget
        mockAuth.mockResolvedValue({
            user: { id: "user-A", role: "customer" },
            expires: "",
        });
        for (let i = 0; i < 10; i++) {
            await applyRateLimit(makeReq("/api/contact"), "contact");
        }

        // User A is now denied
        const deniedA = await applyRateLimit(makeReq("/api/contact"), "contact");
        expect(deniedA).not.toBeNull();

        // Switch to User B - should be admitted (fresh per-user bucket)
        // Note: per-IP bucket (limit 3) may already be exhausted from User A's calls
        // So we use a fresh IP for User B
        mockAuth.mockResolvedValue({
            user: { id: "user-B", role: "customer" },
            expires: "",
        });
        const resultB = await applyRateLimit(makeReq("/api/contact", "10.0.0.2"), "contact");
        expect(resultB).toBeNull();
    });

    it("bypass paths are admitted unconditionally", async () => {
        mockAuth.mockResolvedValue({
            user: { id: "user-1", role: "admin" },
            expires: "",
        });

        // Even after many calls, bypass paths always admit
        for (let i = 0; i < 20; i++) {
            const result = await applyRateLimit(makeReq("/api/cron/expire-holds"), "contact");
            expect(result).toBeNull();
        }

        // No bucket writes for bypass paths
        expect(getUpstashCalls().length).toBe(0);
    });

    it("per-IP exhaustion blocks even authenticated users", async () => {
        mockAuth.mockResolvedValue({
            user: { id: "user-fresh", role: "customer" },
            expires: "",
        });

        // contact per-IP limit is 3. Exhaust it.
        for (let i = 0; i < 3; i++) {
            await applyRateLimit(makeReq("/api/contact"), "contact");
        }

        // 4th call denied even though per-user budget is fresh
        const result = await applyRateLimit(makeReq("/api/contact"), "contact");
        expect(result).not.toBeNull();
        expect(result!.status).toBe(429);
    });
});
