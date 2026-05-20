import { describe, expect, it } from "vitest";

import { getPostHogSessionId } from "./posthog";

describe("posthog — getPostHogSessionId", () => {
    it("reads from a `Headers` instance", () => {
        const h = new Headers({ "x-posthog-session-id": "01J0F9E0-abc" });
        expect(getPostHogSessionId(h)).toBe("01J0F9E0-abc");
    });

    it("reads from a plain record (server-action shape)", () => {
        expect(getPostHogSessionId({ "x-posthog-session-id": "sid-1" })).toBe("sid-1");
    });

    it("returns null when the header is missing", () => {
        expect(getPostHogSessionId(new Headers())).toBeNull();
        expect(getPostHogSessionId({})).toBeNull();
    });

    it("returns null for whitespace-only values", () => {
        expect(getPostHogSessionId(new Headers({ "x-posthog-session-id": "   " }))).toBeNull();
    });

    it("trims and caps the value at 64 chars", () => {
        const long = "  " + "a".repeat(200);
        const out = getPostHogSessionId(new Headers({ "x-posthog-session-id": long }));
        expect(out).toBeDefined();
        expect(out!.length).toBe(64);
        expect(out!.startsWith("a")).toBe(true);
    });

    it("is case-insensitive via Headers (HTTP semantics)", () => {
        const h = new Headers();
        h.set("X-POSTHOG-SESSION-ID", "uppercase-ok");
        expect(getPostHogSessionId(h)).toBe("uppercase-ok");
    });
});
