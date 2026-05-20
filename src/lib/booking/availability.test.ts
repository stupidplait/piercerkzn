/**
 * Unit tests for the availability scheduler. Pure logic — no DB.
 */
import { describe, expect, it } from "vitest";

import { fc, fcAssert } from "@/test/property/fc-config";

import {
    computeSlotsForDay,
    dayOfWeekForDate,
    eachDateInRange,
    minutesToHm,
    parseHmsToMinutes,
    subtractIntervals,
} from "./availability";

const HH = (h: number, m = 0) => h * 60 + m;

describe("parseHmsToMinutes", () => {
    it("parses HH:MM:SS", () => {
        expect(parseHmsToMinutes("10:30:00")).toBe(630);
    });
    it("parses HH:MM", () => {
        expect(parseHmsToMinutes("19:00")).toBe(19 * 60);
    });
    it("returns null for invalid input", () => {
        expect(parseHmsToMinutes("nope")).toBe(null);
        expect(parseHmsToMinutes("25:00")).toBe(null);
        expect(parseHmsToMinutes(null)).toBe(null);
    });
});

describe("minutesToHm", () => {
    it("zero-pads", () => {
        expect(minutesToHm(0)).toBe("00:00");
        expect(minutesToHm(9 * 60 + 5)).toBe("09:05");
        expect(minutesToHm(23 * 60 + 59)).toBe("23:59");
    });
});

describe("subtractIntervals", () => {
    it("returns the base when busy is empty", () => {
        expect(subtractIntervals({ start: 0, end: 60 }, [])).toEqual([{ start: 0, end: 60 }]);
    });

    it("subtracts a single middle interval", () => {
        expect(
            subtractIntervals({ start: HH(10), end: HH(19) }, [{ start: HH(13), end: HH(14) }])
        ).toEqual([
            { start: HH(10), end: HH(13) },
            { start: HH(14), end: HH(19) },
        ]);
    });

    it("merges overlapping busy ranges", () => {
        expect(
            subtractIntervals({ start: 0, end: 100 }, [
                { start: 10, end: 30 },
                { start: 25, end: 50 },
            ])
        ).toEqual([
            { start: 0, end: 10 },
            { start: 50, end: 100 },
        ]);
    });

    it("clips busy ranges that extend past the base", () => {
        expect(
            subtractIntervals({ start: 100, end: 200 }, [
                { start: 50, end: 120 },
                { start: 180, end: 250 },
            ])
        ).toEqual([{ start: 120, end: 180 }]);
    });

    it("returns empty when busy fully covers base", () => {
        expect(subtractIntervals({ start: 0, end: 60 }, [{ start: 0, end: 60 }])).toEqual([]);
    });

    it("ignores zero-length busy ranges", () => {
        expect(subtractIntervals({ start: 0, end: 60 }, [{ start: 30, end: 30 }])).toEqual([
            { start: 0, end: 60 },
        ]);
    });
});

describe("computeSlotsForDay", () => {
    const baseDay = {
        date: "2026-05-15",
        workingWindow: { start: HH(10), end: HH(19) },
        breaks: [{ start: HH(13), end: HH(14) }], // lunch
        blocks: [],
        appointments: [],
        earliestStartMin: 0,
        requiredDurationMin: 30,
        slotStepMin: 30,
    };

    it("returns no slots on closed days", () => {
        const r = computeSlotsForDay({ ...baseDay, workingWindow: null });
        expect(r.isWorkingDay).toBe(false);
        expect(r.slots).toEqual([]);
    });

    it("emits a slot every step in a free interval", () => {
        const r = computeSlotsForDay({ ...baseDay, breaks: [], requiredDurationMin: 60 });
        // 10:00..19:00 with 60-min duration, 30-min step
        // First slot 10:00 (10:00-11:00 fits), …, last 18:00 (18:00-19:00 fits).
        expect(r.slots[0]).toBe("10:00");
        expect(r.slots[r.slots.length - 1]).toBe("18:00");
        expect(r.slots).toContain("18:00");
        expect(r.slots).not.toContain("18:30"); // 18:30-19:30 doesn't fit
    });

    it("respects breaks", () => {
        const r = computeSlotsForDay({ ...baseDay, requiredDurationMin: 30 });
        // Lunch 13:00-14:00 → no 12:30, 13:00, 13:30 slots (12:30+30 = 13:00 still fits actually)
        expect(r.slots).toContain("12:30"); // 12:30-13:00 fits before lunch
        expect(r.slots).not.toContain("13:00"); // would land in lunch
        expect(r.slots).not.toContain("13:30"); // would land in lunch
        expect(r.slots).toContain("14:00"); // resumes after lunch
    });

    it("treats blocks like one-off breaks", () => {
        const r = computeSlotsForDay({
            ...baseDay,
            breaks: [],
            blocks: [{ start: HH(15), end: HH(17) }],
        });
        expect(r.slots).not.toContain("15:00");
        expect(r.slots).not.toContain("16:00");
        expect(r.slots).toContain("17:00");
        expect(r.slots).toContain("14:30"); // 14:30-15:00 fits before block
    });

    it("subtracts existing appointments", () => {
        const r = computeSlotsForDay({
            ...baseDay,
            breaks: [],
            appointments: [{ start: HH(11), end: HH(11, 30) }],
        });
        expect(r.slots).not.toContain("11:00");
        expect(r.slots).toContain("11:30");
    });

    it("honors earliestStartMin for 'today'", () => {
        const r = computeSlotsForDay({
            ...baseDay,
            breaks: [],
            earliestStartMin: HH(11, 15),
        });
        // First viable slot: 11:30 (snapped to grid above the floor)
        expect(r.slots[0]).toBe("11:30");
        expect(r.slots).not.toContain("11:00");
    });

    it("returns no slots when required duration exceeds the window", () => {
        const r = computeSlotsForDay({
            ...baseDay,
            breaks: [],
            requiredDurationMin: 60 * 24,
        });
        expect(r.slots).toEqual([]);
    });
});

describe("eachDateInRange", () => {
    it("includes both ends", () => {
        expect(eachDateInRange("2026-05-15", "2026-05-17")).toEqual([
            "2026-05-15",
            "2026-05-16",
            "2026-05-17",
        ]);
    });
    it("returns [] when end < start", () => {
        expect(eachDateInRange("2026-05-17", "2026-05-15")).toEqual([]);
    });
    it("handles a single day", () => {
        expect(eachDateInRange("2026-05-15", "2026-05-15")).toEqual(["2026-05-15"]);
    });
});

describe("dayOfWeekForDate", () => {
    // 2026-05-15 is a Friday. Mon=0 → Fri=4.
    it("returns 0 for Monday", () => {
        expect(dayOfWeekForDate("2026-05-11")).toBe(0);
    });
    it("returns 4 for Friday", () => {
        expect(dayOfWeekForDate("2026-05-15")).toBe(4);
    });
    it("returns 6 for Sunday", () => {
        expect(dayOfWeekForDate("2026-05-17")).toBe(6);
    });
    it("returns null for malformed input", () => {
        expect(dayOfWeekForDate("not-a-date")).toBe(null);
    });
});

describe("computeSlotsForDay — properties (Phase 3 PBT)", () => {
    // Property 6 covers four sub-clauses on every emitted slot:
    //   (1) Working-window fit  — `start ≥ workingWindow.start` AND
    //       `end ≤ workingWindow.end` (where `end = start + requiredDurationMin`).
    //   (2) Earliest-start floor — `start ≥ earliestStartMin`.
    //   (3) Slot-grid alignment  — `(start − workingWindow.start) % slotStepMin === 0`.
    //   (4) No overlap with any busy interval — for every busy interval `b` in
    //       `breaks ∪ blocks ∪ appointments`, `end ≤ b.start || start ≥ b.end`.
    //
    // Slot output is `HH:MM` strings (see `availability.ts` → `minutesToHm`),
    // so we recover minute values via `parseHmsToMinutes`.
    //
    // Generator constraints (from design.md §"Phase 3 PBTs"):
    //   * `timeRangeArb` produces non-empty ranges in `[0, 1440]`.
    //   * `dayInputArb.workingWindow` is filtered to span ≥ 30 minutes so the
    //     scheduler has room to emit at least the trivial slot when the
    //     duration fits.
    //   * `slotStepMin ∈ {15, 30, 60}` mirrors the production grid.
    //
    // Runs in the unit suite (no DB), goes through `fcAssert` (per Req 7.6
    // and the `local/no-direct-fc-assert` ESLint rule).
    //
    // Feature: testing-strategy-rollout, Property 6: Booking-availability slots respect every busy interval
    it("Property 6: every emitted slot satisfies fit, floor, alignment, and non-overlap (Req 3.7)", () => {
        const timeRangeArb = fc
            .tuple(fc.integer({ min: 0, max: 1440 }), fc.integer({ min: 1, max: 60 }))
            .map(([start, len]) => ({ start, end: Math.min(1440, start + len) }))
            .filter((r) => r.end > r.start);

        const dayInputArb = fc.record({
            date: fc.constant("2026-01-15"),
            workingWindow: timeRangeArb.filter((r) => r.end - r.start >= 30),
            breaks: fc.array(timeRangeArb, { maxLength: 3 }),
            blocks: fc.array(timeRangeArb, { maxLength: 3 }),
            appointments: fc.array(timeRangeArb, { maxLength: 5 }),
            earliestStartMin: fc.integer({ min: 0, max: 1440 }),
            requiredDurationMin: fc.integer({ min: 15, max: 120 }),
            slotStepMin: fc.constantFrom(15, 30, 60),
        });

        fcAssert(
            fc.property(dayInputArb, (day) => {
                const out = computeSlotsForDay(day);
                const window = day.workingWindow;
                const busyAll = [...day.breaks, ...day.blocks, ...day.appointments];

                for (const slot of out.slots) {
                    const start = parseHmsToMinutes(slot);
                    // Sanity: the implementation always emits valid `HH:MM`.
                    expect(start).not.toBe(null);
                    const startM = start as number;
                    const endM = startM + day.requiredDurationMin;

                    // (1) Working-window fit.
                    expect(startM).toBeGreaterThanOrEqual(window.start);
                    expect(endM).toBeLessThanOrEqual(window.end);

                    // (2) Earliest-start floor.
                    expect(startM).toBeGreaterThanOrEqual(day.earliestStartMin);

                    // (3) Slot-grid alignment relative to `workingWindow.start`.
                    expect((startM - window.start) % day.slotStepMin).toBe(0);

                    // (4) No overlap with any busy interval.
                    for (const busy of busyAll) {
                        expect(endM <= busy.start || startM >= busy.end).toBe(true);
                    }
                }
            })
        );
    });
});
