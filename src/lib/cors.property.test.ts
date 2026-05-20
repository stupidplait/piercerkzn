// Feature: public-form-abuse-hardening, Properties 14-18: CORS
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fc, fcAssert } from "@/test/property/fc-config";
import {
    parseAllowlist,
    getAllowlist,
    __resetCorsCache,
    decideCors,
    applyCors,
    handlePreflight,
} from "@/lib/cors";

vi.mock("@/lib/env", () => ({
    env: {
        CORS_ALLOWED_ORIGINS:
            "https://piercer.kzn,https://staging.piercer.kzn,https://miniapp.piercer.kzn",
    },
}));

import { env } from "@/lib/env";

const ALLOWLIST = [
    "https://piercer.kzn",
    "https://staging.piercer.kzn",
    "https://miniapp.piercer.kzn",
];

function makeReq(url: string, origin?: string): Request {
    const headers = new Headers();
    if (origin) headers.set("origin", origin);
    return new Request(url, { headers });
}

describe("CORS property tests", () => {
    beforeEach(() => {
        __resetCorsCache();
        (env as any).CORS_ALLOWED_ORIGINS = ALLOWLIST.join(",");
    });

    // Property 14: CORS allowed-decision header correctness
    it("P14: allowed origin gets exact ACAO, Vary, and ACAC iff credentialed", () => {
        const originArb = fc.constantFrom(...ALLOWLIST);
        const pathArb = fc.constantFrom(
            "/api/contact",
            "/api/reviews",
            "/api/reservations",
            "/api/reservations/123",
            "/api/account/profile",
            "/api/admin/settings",
            "/api/blog/posts"
        );

        const credentialedPatterns = [
            /^\/api\/account(\/|$)/,
            /^\/api\/reservations/,
            /^\/api\/admin(\/|$)/,
        ];

        fcAssert(
            fc.property(originArb, pathArb, (origin, path) => {
                const req = makeReq(`http://test.local${path}`, origin);
                const decision = decideCors(req);
                const res = new Response();
                applyCors(res, decision);

                // ACAO must be the exact origin, never *
                const acao = res.headers.get("access-control-allow-origin");
                if (acao !== origin) return false;
                if (acao === "*") return false;

                // Vary must include Origin
                if (!res.headers.get("vary")?.includes("Origin")) return false;

                // ACAC iff credentialed
                const isCredentialed = credentialedPatterns.some((re) => re.test(path));
                const hasAcac = res.headers.get("access-control-allow-credentials") === "true";
                return hasAcac === isCredentialed;
            }),
            { seed: 14 }
        );
    });

    // Property 15: CORS denied / no_origin / malformed produces no ACAO
    it("P15: denied/no_origin/malformed produces no ACAO or ACAC", () => {
        const deniedOriginArb = fc.oneof(
            fc.constantFrom("https://evil.com", "https://attacker.io", "http://localhost:9999"),
            fc.constant("not-a-url"),
            fc.constant("://broken")
        );

        fcAssert(
            fc.property(fc.option(deniedOriginArb, { nil: undefined }), (origin) => {
                const req = makeReq("http://test.local/api/contact", origin);
                const decision = decideCors(req);
                const res = new Response();
                applyCors(res, decision);

                return (
                    !res.headers.has("access-control-allow-origin") &&
                    !res.headers.has("access-control-allow-credentials")
                );
            }),
            { seed: 15 }
        );
    });

    // Property 16: CORS preflight comprehensive switch over CorsDecision union
    it("P16: handlePreflight returns correct status per decision variant", () => {
        const caseArb = fc.constantFrom(
            { origin: "https://piercer.kzn", expectedStatus: 204 },
            { origin: "https://evil.com", expectedStatus: 403 },
            { origin: "not-a-url", expectedStatus: 403 },
            { origin: undefined as string | undefined, expectedStatus: 405 }
        );

        fcAssert(
            fc.property(caseArb, ({ origin, expectedStatus }) => {
                const req = makeReq("http://test.local/api/contact", origin);
                const res = handlePreflight(req);

                if (res.status !== expectedStatus) return false;

                if (expectedStatus === 204) {
                    if (!res.headers.has("access-control-allow-origin")) return false;
                    if (!res.headers.has("access-control-allow-methods")) return false;
                    if (!res.headers.has("access-control-allow-headers")) return false;
                    if (res.headers.get("access-control-max-age") !== "600") return false;
                } else if (expectedStatus === 403) {
                    if (res.headers.has("access-control-allow-origin")) return false;
                } else if (expectedStatus === 405) {
                    if (!res.headers.has("allow")) return false;
                    if (res.headers.has("access-control-allow-origin")) return false;
                }
                return true;
            }),
            { seed: 16 }
        );
    });

    // Property 17: Allowlist parser invariant
    it("P17: parsed allowlist entries are non-empty, no wildcards, valid origins", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

        const rawArb = fc
            .array(
                fc.oneof(
                    fc.webUrl({ withFragments: false, withQueryParameters: false }),
                    fc.string(),
                    fc.constant("*"),
                    fc.constant("https://*.example.com")
                ),
                { maxLength: 20 }
            )
            .map((arr) => arr.join(","));

        fcAssert(
            fc.property(rawArb, (raw) => {
                warnSpy.mockClear();
                const result = parseAllowlist(raw);

                for (const entry of result) {
                    if (entry.length === 0) return false;
                    if (entry.includes("*")) return false;
                    try {
                        if (new URL(entry).origin !== entry) return false;
                    } catch {
                        return false;
                    }
                }

                // Wildcard inputs should have triggered console.warn
                const wildcardCount = raw.split(",").filter((s) => s.trim().includes("*")).length;
                if (wildcardCount > 0 && warnSpy.mock.calls.length === 0) return false;

                return true;
            }),
            { seed: 17 }
        );

        warnSpy.mockRestore();
    });

    // Property 18: decideCors is referentially transparent
    it("P18: decideCors returns equal results for identical inputs", () => {
        const originArb = fc.option(
            fc.oneof(
                fc.constantFrom(...ALLOWLIST),
                fc.constantFrom("https://evil.com", "not-a-url")
            ),
            { nil: undefined }
        );
        const pathArb = fc.constantFrom("/api/contact", "/api/reservations", "/api/admin/x");

        fcAssert(
            fc.property(originArb, pathArb, (origin, path) => {
                const req1 = makeReq(`http://test.local${path}`, origin);
                const req2 = makeReq(`http://test.local${path}`, origin);
                const d1 = decideCors(req1);
                const d2 = decideCors(req2);
                return JSON.stringify(d1) === JSON.stringify(d2);
            }),
            { seed: 18 }
        );
    });
});
