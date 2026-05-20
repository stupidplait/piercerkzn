/**
 * Unit tests for booking time helpers.
 *
 * Studio is permanently UTC+03:00 (Europe/Moscow, no DST since 2014). All
 * conversions assert that against `Date.UTC(...)`.
 */
import { describe, expect, it } from "vitest";

import { appointmentStartUtc, delayMsUntil, formatStudioDateTime, STUDIO_UTC_OFFSET } from "./time";

describe("appointmentStartUtc", () => {
    it("converts wall-clock studio time to UTC", () => {
        // 14:30 Moscow = 11:30 UTC.
        const d = appointmentStartUtc("2026-05-14", "14:30");
        expect(d).not.toBeNull();
        expect(d!.getTime()).toBe(Date.UTC(2026, 4, 14, 11, 30, 0));
    });

    it("accepts HH:MM:SS form too", () => {
        const a = appointmentStartUtc("2026-05-14", "14:30:00");
        const b = appointmentStartUtc("2026-05-14", "14:30");
        expect(a?.getTime()).toBe(b?.getTime());
    });

    it("returns null for malformed input", () => {
        expect(appointmentStartUtc("2026/05/14", "14:30")).toBeNull();
        expect(appointmentStartUtc("2026-05-14", "14")).toBeNull();
        expect(appointmentStartUtc("2026-05-14", "ab:cd")).toBeNull();
    });

    it("uses the documented +03:00 offset", () => {
        expect(STUDIO_UTC_OFFSET).toBe("+03:00");
    });
});

describe("delayMsUntil", () => {
    it("returns positive ms for a future target", () => {
        const now = new Date("2026-05-14T10:00:00Z");
        const t = new Date("2026-05-14T11:00:00Z");
        expect(delayMsUntil(t, now)).toBe(60 * 60 * 1000);
    });

    it("clamps past targets to zero", () => {
        const now = new Date("2026-05-14T10:00:00Z");
        const t = new Date("2026-05-14T09:00:00Z");
        expect(delayMsUntil(t, now)).toBe(0);
    });
});

describe("formatStudioDateTime", () => {
    it("renders MSK wall-clock with the studio offset", () => {
        // 11:30 UTC = 14:30 MSK
        const utc = new Date("2026-05-14T11:30:00Z");
        const formatted = formatStudioDateTime(utc);
        expect(formatted).toMatch(/14\.05\.2026/u);
        expect(formatted).toMatch(/14:30/u);
        expect(formatted).toMatch(/МСК$/u);
    });
});
