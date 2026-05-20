import { describe, it, expect, vi, beforeEach } from "vitest";
import { handlePreflight, __resetCorsCache } from "@/lib/cors";

vi.mock("@/lib/env", () => ({
    env: {
        CORS_ALLOWED_ORIGINS: "https://piercer.kzn,https://staging.piercer.kzn",
    },
}));

import { env } from "@/lib/env";

function makeOptionsReq(path: string, origin?: string): Request {
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    headers.set("access-control-request-method", "POST");
    headers.set("access-control-request-headers", "content-type");
    return new Request(`http://test.local${path}`, { method: "OPTIONS", headers });
}

describe("CORS preflight integration", () => {
    beforeEach(() => {
        __resetCorsCache();
        (env as any).CORS_ALLOWED_ORIGINS = "https://piercer.kzn,https://staging.piercer.kzn";
    });

    it("returns 204 with full CORS headers for allowed origin", () => {
        const req = makeOptionsReq("/api/contact", "https://piercer.kzn");
        const res = handlePreflight(req);

        expect(res.status).toBe(204);
        expect(res.headers.get("access-control-allow-origin")).toBe("https://piercer.kzn");
        expect(res.headers.get("access-control-allow-methods")).toContain("POST");
        expect(res.headers.get("access-control-allow-methods")).toContain("GET");
        expect(res.headers.get("access-control-allow-methods")).toContain("DELETE");
        expect(res.headers.get("access-control-allow-methods")).toContain("OPTIONS");
        expect(res.headers.get("access-control-allow-headers")).toContain("Content-Type");
        expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
        expect(res.headers.get("access-control-max-age")).toBe("600");
        expect(res.headers.get("vary")).toContain("Origin");
    });

    it("includes ACAC for credentialed route (/api/reservations)", () => {
        const req = makeOptionsReq("/api/reservations", "https://piercer.kzn");
        const res = handlePreflight(req);

        expect(res.status).toBe(204);
        expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    });

    it("includes ACAC for credentialed route (/api/account/profile)", () => {
        const req = makeOptionsReq("/api/account/profile", "https://piercer.kzn");
        const res = handlePreflight(req);

        expect(res.status).toBe(204);
        expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    });

    it("does NOT include ACAC for non-credentialed route (/api/contact)", () => {
        const req = makeOptionsReq("/api/contact", "https://piercer.kzn");
        const res = handlePreflight(req);

        expect(res.status).toBe(204);
        expect(res.headers.has("access-control-allow-credentials")).toBe(false);
    });

    it("returns 403 for denied origin", () => {
        const req = makeOptionsReq("/api/contact", "https://evil.com");
        const res = handlePreflight(req);

        expect(res.status).toBe(403);
        expect(res.headers.has("access-control-allow-origin")).toBe(false);
        expect(res.headers.has("access-control-allow-methods")).toBe(false);
    });

    it("returns 403 for malformed origin", () => {
        const req = makeOptionsReq("/api/contact", "not-a-url");
        const res = handlePreflight(req);

        expect(res.status).toBe(403);
    });

    it("returns 405 with Allow header when no Origin", () => {
        const req = makeOptionsReq("/api/contact");
        const res = handlePreflight(req);

        expect(res.status).toBe(405);
        expect(res.headers.get("allow")).toContain("GET");
        expect(res.headers.get("allow")).toContain("POST");
        expect(res.headers.has("access-control-allow-origin")).toBe(false);
    });

    it("echoes the exact allowlisted origin, never *", () => {
        const req = makeOptionsReq("/api/contact", "https://staging.piercer.kzn");
        const res = handlePreflight(req);

        expect(res.status).toBe(204);
        expect(res.headers.get("access-control-allow-origin")).toBe("https://staging.piercer.kzn");
        expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
    });
});
