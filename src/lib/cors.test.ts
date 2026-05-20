import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
    parseAllowlist,
    getAllowlist,
    __resetCorsCache,
    decideCors,
    applyCors,
    handlePreflight,
    type CorsDecision,
} from "@/lib/cors";

vi.mock("@/lib/env", () => ({
    env: {
        CORS_ALLOWED_ORIGINS: "https://piercer.kzn,https://staging.piercer.kzn",
    },
}));

import { env } from "@/lib/env";

function makeReq(url: string, origin?: string): Request {
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    return new Request(url, { headers });
}

describe("parseAllowlist", () => {
    it("returns empty array for empty string", () => {
        expect(parseAllowlist("")).toEqual([]);
    });

    it("parses single entry", () => {
        expect(parseAllowlist("https://example.com")).toEqual(["https://example.com"]);
    });

    it("parses multiple entries with whitespace", () => {
        expect(parseAllowlist(" https://a.com , https://b.com ")).toEqual([
            "https://a.com",
            "https://b.com",
        ]);
    });

    it("discards entries with trailing slash", () => {
        expect(parseAllowlist("https://example.com/")).toEqual([]);
    });

    it("discards wildcard entries and warns", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const result = parseAllowlist("https://*.example.com,*");
        expect(result).toEqual([]);
        expect(warnSpy).toHaveBeenCalledTimes(2);
        expect(warnSpy.mock.calls[0][0]).toContain("[cors] discarded wildcard entry:");
        warnSpy.mockRestore();
    });

    it("discards malformed URLs", () => {
        expect(parseAllowlist("not-a-url,://broken")).toEqual([]);
    });

    it("returns frozen array", () => {
        const result = parseAllowlist("https://x.com");
        expect(Object.isFrozen(result)).toBe(true);
    });
});

describe("decideCors", () => {
    beforeEach(() => {
        __resetCorsCache();
        (env as any).CORS_ALLOWED_ORIGINS = "https://piercer.kzn,https://staging.piercer.kzn";
    });

    it("returns no_origin when Origin header is absent", () => {
        const req = makeReq("http://test.local/api/contact");
        expect(decideCors(req)).toEqual({ kind: "no_origin" });
    });

    it("returns allowed for allowlisted origin", () => {
        const req = makeReq("http://test.local/api/contact", "https://piercer.kzn");
        const decision = decideCors(req);
        expect(decision).toEqual({
            kind: "allowed",
            origin: "https://piercer.kzn",
            credentialed: false,
        });
    });

    it("returns allowed + credentialed for /api/reservations", () => {
        const req = makeReq("http://test.local/api/reservations", "https://piercer.kzn");
        const decision = decideCors(req);
        expect(decision).toEqual({
            kind: "allowed",
            origin: "https://piercer.kzn",
            credentialed: true,
        });
    });

    it("returns allowed + credentialed for /api/account/profile", () => {
        const req = makeReq("http://test.local/api/account/profile", "https://piercer.kzn");
        expect(decideCors(req)).toMatchObject({ kind: "allowed", credentialed: true });
    });

    it("returns allowed + credentialed for /api/admin/settings", () => {
        const req = makeReq("http://test.local/api/admin/settings", "https://piercer.kzn");
        expect(decideCors(req)).toMatchObject({ kind: "allowed", credentialed: true });
    });

    it("returns denied for origin not in allowlist", () => {
        const req = makeReq("http://test.local/api/contact", "https://evil.com");
        expect(decideCors(req)).toEqual({
            kind: "denied",
            origin: "https://evil.com",
            reason: "not_in_allowlist",
        });
    });

    it("returns denied for malformed origin", () => {
        const req = makeReq("http://test.local/api/contact", "not-a-url");
        expect(decideCors(req)).toEqual({
            kind: "denied",
            origin: "not-a-url",
            reason: "malformed_origin",
        });
    });
});

describe("applyCors", () => {
    it("sets ACAO and Vary for allowed decision", () => {
        const res = new Response();
        const decision: CorsDecision = {
            kind: "allowed",
            origin: "https://piercer.kzn",
            credentialed: false,
        };
        applyCors(res, decision);
        expect(res.headers.get("access-control-allow-origin")).toBe("https://piercer.kzn");
        expect(res.headers.get("vary")).toContain("Origin");
        expect(res.headers.has("access-control-allow-credentials")).toBe(false);
    });

    it("sets ACAC for credentialed decision", () => {
        const res = new Response();
        const decision: CorsDecision = {
            kind: "allowed",
            origin: "https://piercer.kzn",
            credentialed: true,
        };
        applyCors(res, decision);
        expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    });

    it("does not set headers for denied decision", () => {
        const res = new Response();
        const decision: CorsDecision = {
            kind: "denied",
            origin: "https://evil.com",
            reason: "not_in_allowlist",
        };
        applyCors(res, decision);
        expect(res.headers.has("access-control-allow-origin")).toBe(false);
    });

    it("does not set headers for no_origin decision", () => {
        const res = new Response();
        applyCors(res, { kind: "no_origin" });
        expect(res.headers.has("access-control-allow-origin")).toBe(false);
    });
});

describe("handlePreflight", () => {
    beforeEach(() => {
        __resetCorsCache();
        (env as any).CORS_ALLOWED_ORIGINS = "https://piercer.kzn";
    });

    it("returns 204 with CORS headers for allowed origin", () => {
        const req = makeReq("http://test.local/api/contact", "https://piercer.kzn");
        const res = handlePreflight(req);
        expect(res.status).toBe(204);
        expect(res.headers.get("access-control-allow-origin")).toBe("https://piercer.kzn");
        expect(res.headers.get("access-control-allow-methods")).toContain("POST");
        expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
        expect(res.headers.get("access-control-max-age")).toBe("600");
        expect(res.headers.get("vary")).toContain("Origin");
    });

    it("includes ACAC for credentialed route preflight", () => {
        const req = makeReq("http://test.local/api/reservations", "https://piercer.kzn");
        const res = handlePreflight(req);
        expect(res.status).toBe(204);
        expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    });

    it("returns 403 for denied origin", () => {
        const req = makeReq("http://test.local/api/contact", "https://evil.com");
        const res = handlePreflight(req);
        expect(res.status).toBe(403);
        expect(res.headers.has("access-control-allow-origin")).toBe(false);
    });

    it("returns 405 with Allow header when no Origin", () => {
        const req = makeReq("http://test.local/api/contact");
        const res = handlePreflight(req);
        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toContain("GET");
        expect(res.headers.has("access-control-allow-origin")).toBe(false);
    });
});
