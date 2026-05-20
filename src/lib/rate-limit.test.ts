import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
    env: {
        CRON_SECRET: "test-cron-secret-value",
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

vi.mock("@/lib/redis", () => ({
    upstash: null,
    hasUpstash: () => false,
}));

import { PER_USER_KIND, isBypassPath, ipFromHeaders } from "@/lib/rate-limit";
import { env } from "@/lib/env";

function makeReq(url: string, headers?: Record<string, string>): Request {
    const h = new Headers(headers);
    return new Request(url, { headers: h });
}

describe("PER_USER_KIND", () => {
    it("maps contact to contact_user", () => {
        expect(PER_USER_KIND.contact).toBe("contact_user");
    });

    it("maps reservation to reservation_user", () => {
        expect(PER_USER_KIND.reservation).toBe("reservation_user");
    });

    it("has no per-user counterpart for auth", () => {
        expect(PER_USER_KIND.auth).toBeUndefined();
    });

    it("has no per-user counterpart for booking", () => {
        expect(PER_USER_KIND.booking).toBeUndefined();
    });

    it("has no per-user counterpart for upload", () => {
        expect(PER_USER_KIND.upload).toBeUndefined();
    });
});

describe("isBypassPath", () => {
    it("returns true for /api/cron/ prefix", () => {
        expect(isBypassPath(makeReq("http://test.local/api/cron/expire-holds"))).toBe(true);
    });

    it("returns true for /api/internal/ prefix", () => {
        expect(isBypassPath(makeReq("http://test.local/api/internal/health"))).toBe(true);
    });

    it("returns true when X-Cron-Secret matches env.CRON_SECRET", () => {
        const req = makeReq("http://test.local/api/contact", {
            "x-cron-secret": "test-cron-secret-value",
        });
        expect(isBypassPath(req)).toBe(true);
    });

    it("returns false for /api/contact", () => {
        expect(isBypassPath(makeReq("http://test.local/api/contact"))).toBe(false);
    });

    it("returns false when X-Cron-Secret does not match", () => {
        const req = makeReq("http://test.local/api/contact", {
            "x-cron-secret": "wrong-secret",
        });
        expect(isBypassPath(req)).toBe(false);
    });

    it("returns false for /api/cron without trailing slash", () => {
        expect(isBypassPath(makeReq("http://test.local/api/cron"))).toBe(false);
    });
});

describe("ipFromHeaders", () => {
    it("prefers cf-connecting-ip", () => {
        const h = new Headers({
            "cf-connecting-ip": "1.1.1.1",
            "x-real-ip": "2.2.2.2",
            "x-forwarded-for": "3.3.3.3",
        });
        expect(ipFromHeaders(h)).toBe("1.1.1.1");
    });

    it("falls back to x-real-ip", () => {
        const h = new Headers({ "x-real-ip": "2.2.2.2" });
        expect(ipFromHeaders(h)).toBe("2.2.2.2");
    });

    it("falls back to first x-forwarded-for entry", () => {
        const h = new Headers({ "x-forwarded-for": "3.3.3.3, 4.4.4.4" });
        expect(ipFromHeaders(h)).toBe("3.3.3.3");
    });

    it("returns unknown when no IP headers present", () => {
        expect(ipFromHeaders(new Headers())).toBe("unknown");
    });
});
