/**
 * Unit tests for aftercare drip timing math.
 *
 * Studio = Europe/Moscow (UTC+03:00, constant). Each drip step fires at
 * 09:00 МСК on `piercingDate + offsetDays[step]`, i.e. 06:00 UTC.
 */
import { describe, expect, it } from "vitest";

import { AFTERCARE_STEPS, STEP_OFFSET_DAYS, addDaysIso, aftercareStepFireUtc } from "./time";

describe("AFTERCARE_STEPS", () => {
    it("covers all seven drip steps in canonical order", () => {
        expect(AFTERCARE_STEPS).toEqual([
            "day1",
            "day3",
            "day7",
            "day14",
            "day30",
            "day60",
            "day90",
        ]);
    });

    it("has exactly 7 entries", () => {
        // Belt-and-suspenders against future migrations adding/removing a
        // step without updating the corresponding maps in
        // `emails/aftercare-step.tsx`, `emails/dispatch.ts`, and
        // `lib/telegram/notifications.ts`.
        expect(AFTERCARE_STEPS).toHaveLength(7);
    });

    it("steps are listed in strictly chronological order", () => {
        // Validates the design's "chronological 7-element tuple"
        // contract — each successive step's offset must be > the prior
        // step's offset so the drip cadence reads naturally to consumers
        // of `AFTERCARE_STEPS` (workers iterating, sweeper iterating).
        for (let i = 1; i < AFTERCARE_STEPS.length; i++) {
            const prev = AFTERCARE_STEPS[i - 1];
            const curr = AFTERCARE_STEPS[i];
            expect(STEP_OFFSET_DAYS[curr]).toBeGreaterThan(STEP_OFFSET_DAYS[prev]);
        }
    });

    it("uses the documented step offsets", () => {
        expect(STEP_OFFSET_DAYS).toEqual({
            day1: 1,
            day3: 3,
            day7: 7,
            day14: 14,
            day30: 30,
            day60: 60,
            day90: 90,
        });
    });
});

describe("addDaysIso", () => {
    it("adds N days across a month boundary", () => {
        expect(addDaysIso("2026-05-30", 7)).toBe("2026-06-06");
    });

    it("returns null for malformed input", () => {
        expect(addDaysIso("2026/05/30", 1)).toBeNull();
        expect(addDaysIso("not-a-date", 1)).toBeNull();
    });
});

describe("aftercareStepFireUtc", () => {
    it("returns 09:00 МСК = 06:00 UTC on the offset day", () => {
        // Piercing on 14 May 2026 → Day 1 fires at 06:00 UTC on 15 May 2026.
        const day1 = aftercareStepFireUtc("2026-05-14", "day1");
        expect(day1).not.toBeNull();
        expect(day1!.toISOString()).toBe("2026-05-15T06:00:00.000Z");
    });

    it("computes Day 3 = piercingDate + 3 days @ 06:00Z", () => {
        const day3 = aftercareStepFireUtc("2026-05-14", "day3");
        expect(day3!.toISOString()).toBe("2026-05-17T06:00:00.000Z");
    });

    it("computes Day 7 = piercingDate + 7 days @ 06:00Z", () => {
        const day7 = aftercareStepFireUtc("2026-05-14", "day7");
        expect(day7!.toISOString()).toBe("2026-05-21T06:00:00.000Z");
    });

    it("computes Day 14 = piercingDate + 14 days @ 06:00Z", () => {
        const day14 = aftercareStepFireUtc("2026-05-14", "day14");
        expect(day14!.toISOString()).toBe("2026-05-28T06:00:00.000Z");
    });

    it("computes Day 30 = piercingDate + 30 days @ 06:00Z", () => {
        const day30 = aftercareStepFireUtc("2026-05-14", "day30");
        expect(day30!.toISOString()).toBe("2026-06-13T06:00:00.000Z");
    });

    it("computes Day 60 = piercingDate + 60 days @ 06:00Z", () => {
        const day60 = aftercareStepFireUtc("2026-05-14", "day60");
        expect(day60!.toISOString()).toBe("2026-07-13T06:00:00.000Z");
    });

    it("computes Day 90 = piercingDate + 90 days @ 06:00Z", () => {
        const day90 = aftercareStepFireUtc("2026-05-14", "day90");
        expect(day90!.toISOString()).toBe("2026-08-12T06:00:00.000Z");
    });

    it("returns null for malformed dates", () => {
        expect(aftercareStepFireUtc("bad", "day1")).toBeNull();
    });
});
