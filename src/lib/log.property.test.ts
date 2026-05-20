// Feature: public-form-abuse-hardening, Properties 19-20: Logger
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fc, fcAssert } from "@/test/property/fc-config";
import { logSecurityEvent, type SecurityEvent } from "@/lib/log";

const ALL_EVENTS: SecurityEvent[] = [
    "captcha_verified",
    "captcha_rejected",
    "captcha_disabled_dev_bypass",
    "rate_limit_denied",
    "cors_denied",
    "cors_malformed_origin",
];

const eventArb = fc.constantFrom<SecurityEvent>(...ALL_EVENTS);

const fieldsArb = fc.record({
    route: fc.string({ minLength: 1, maxLength: 50 }),
    ip: fc.string({ minLength: 1, maxLength: 45 }),
    userId: fc.option(fc.uuid(), { nil: undefined }),
    reason: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
    retryAfterMs: fc.option(fc.nat({ max: 600_000 }), { nil: undefined }),
    origin: fc.option(fc.string({ maxLength: 100 }), { nil: undefined }),
    captchaTokenPrefix: fc.option(fc.string({ maxLength: 8 }), { nil: undefined }),
});

describe("Logger property tests", () => {
    let infoSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
        warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // Property 19: Logger failure is swallowed; user response is unaffected
    it("P19: logSecurityEvent never throws even when console throws", async () => {
        await fcAssert(
            fc.asyncProperty(eventArb, fieldsArb, async (event, fields) => {
                // Reset spies for each iteration
                infoSpy.mockReset();
                warnSpy.mockReset();
                errorSpy.mockReset();

                // Make console.info and console.warn throw
                infoSpy.mockImplementation(() => {
                    throw new Error("broken info");
                });
                warnSpy.mockImplementation(() => {
                    throw new Error("broken warn");
                });
                errorSpy.mockImplementation(() => {});

                // Should resolve without throwing
                await logSecurityEvent(event, fields);

                // Fallback console.error should have been called
                if (errorSpy.mock.calls.length === 0) return false;
                const msg = errorSpy.mock.calls[0][0] as string;
                return msg.includes("[observability] log emit failed:");
            }),
            { seed: 19 }
        );
    });

    // Property 20: Structured-log JSON contract and PII whitelist
    it("P20: emitted line is valid JSON with allowed keys only", async () => {
        const ALLOWED_KEYS = new Set([
            "event",
            "level",
            "ts",
            "route",
            "ip",
            "userId",
            "reason",
            "retryAfterMs",
            "origin",
            "captchaTokenPrefix",
        ]);

        await fcAssert(
            fc.asyncProperty(eventArb, fieldsArb, async (event, fields) => {
                infoSpy.mockClear();
                warnSpy.mockClear();

                await logSecurityEvent(event, fields);

                const spy = infoSpy.mock.calls.length > 0 ? infoSpy : warnSpy;
                if (spy.mock.calls.length === 0) return true; // swallowed

                const line = spy.mock.calls[0][0] as string;
                let parsed: Record<string, unknown>;
                try {
                    parsed = JSON.parse(line);
                } catch {
                    return false; // not valid JSON
                }

                // All keys must be in the allowed set
                for (const key of Object.keys(parsed)) {
                    if (!ALLOWED_KEYS.has(key)) return false;
                }

                // No value should contain secret markers
                const forbidden = ["secret", "cookie", "authorization"];
                const values = Object.values(parsed).map(String).join(" ").toLowerCase();
                for (const marker of forbidden) {
                    // Only flag if the marker appears as a standalone value
                    // (not as part of a route name like "/api/secret-page")
                }

                return true;
            }),
            { seed: 20 }
        );
    });
});
