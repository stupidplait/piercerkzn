import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logSecurityEvent, type SecurityEvent } from "@/lib/log";

describe("lib/log - logSecurityEvent", () => {
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

    it("emits valid JSON to console.info for info-level events", async () => {
        await logSecurityEvent("rate_limit_denied", {
            route: "/api/contact",
            ip: "1.2.3.4",
            reason: "ip:contact",
            retryAfterMs: 5000,
        });
        expect(infoSpy).toHaveBeenCalledTimes(1);
        const line = JSON.parse(infoSpy.mock.calls[0][0] as string);
        expect(line.event).toBe("rate_limit_denied");
        expect(line.level).toBe("info");
        expect(line.route).toBe("/api/contact");
        expect(line.ip).toBe("1.2.3.4");
        expect(line.ts).toBeDefined();
    });

    it("emits to console.warn for warn-level events", async () => {
        await logSecurityEvent("captcha_disabled_dev_bypass", {
            route: "/api/contact",
            ip: "1.2.3.4",
        });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const line = JSON.parse(warnSpy.mock.calls[0][0] as string);
        expect(line.event).toBe("captcha_disabled_dev_bypass");
        expect(line.level).toBe("warn");
    });

    it("swallows serializer errors and emits fallback", async () => {
        // Create a circular reference that JSON.stringify will throw on
        const circular: Record<string, unknown> = { route: "/api/x", ip: "1.1.1.1" };
        circular.self = circular;

        await expect(logSecurityEvent("cors_denied", circular as any)).resolves.toBeUndefined();

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toContain("[observability] log emit failed:");
    });

    it("swallows even when console.error throws", async () => {
        infoSpy.mockImplementation(() => {
            throw new Error("broken info");
        });
        errorSpy.mockImplementation(() => {
            throw new Error("broken error");
        });

        await expect(
            logSecurityEvent("rate_limit_denied", { route: "/x", ip: "0" })
        ).resolves.toBeUndefined();
    });
});
