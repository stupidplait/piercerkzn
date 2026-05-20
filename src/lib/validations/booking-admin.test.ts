/**
 * Validation contract tests for the booking admin surface (services,
 * piercer profile, weekly schedule, exceptions, time blocks).
 */
import { describe, expect, it } from "vitest";

import {
    adminListScheduleExceptionsQuerySchema,
    adminListServicesQuerySchema,
    adminListTimeBlocksQuerySchema,
    createScheduleExceptionSchema,
    createServiceSchema,
    createTimeBlockSchema,
    replaceWeeklyScheduleSchema,
    updatePiercerProfileSchema,
    updateScheduleExceptionSchema,
    updateServiceSchema,
    updateTimeBlockSchema,
    weeklyDayScheduleSchema,
} from "./booking-admin";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
const validService = {
    name: "Хеликс",
    handle: "ear-helix",
    category: "new_piercing" as const,
    durationMinutes: 30,
    priceFrom: 350_000,
};

describe("createServiceSchema", () => {
    it("accepts a minimal payload", () => {
        expect(createServiceSchema.safeParse(validService).success).toBe(true);
    });

    it("rejects priceTo < priceFrom", () => {
        const r = createServiceSchema.safeParse({
            ...validService,
            priceFrom: 500_000,
            priceTo: 100_000,
        });
        expect(r.success).toBe(false);
    });

    it("accepts priceTo == priceFrom (fixed-from-range)", () => {
        const r = createServiceSchema.safeParse({
            ...validService,
            priceTo: validService.priceFrom,
        });
        expect(r.success).toBe(true);
    });

    it("rejects healingTimeMaxWeeks < min", () => {
        const r = createServiceSchema.safeParse({
            ...validService,
            healingTimeMinWeeks: 12,
            healingTimeMaxWeeks: 4,
        });
        expect(r.success).toBe(false);
    });

    it.each([
        ["uppercase handle", "Helix"],
        ["spaces", "ear helix"],
        ["unicode", "хеликс"],
    ])("rejects bad handle: %s", (_label, handle) => {
        const r = createServiceSchema.safeParse({ ...validService, handle });
        expect(r.success).toBe(false);
    });

    it("rejects unknown category", () => {
        const r = createServiceSchema.safeParse({
            ...validService,
            category: "tattoo",
        });
        expect(r.success).toBe(false);
    });

    it("rejects sub-5-minute durations", () => {
        const r = createServiceSchema.safeParse({ ...validService, durationMinutes: 1 });
        expect(r.success).toBe(false);
    });
});

describe("updateServiceSchema", () => {
    it("accepts an empty patch (cross-field re-validated downstream)", () => {
        expect(updateServiceSchema.safeParse({}).success).toBe(true);
    });
});

describe("adminListServicesQuerySchema", () => {
    it("defaults sort to sortOrder", () => {
        const r = adminListServicesQuerySchema.safeParse({});
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.sort).toBe("sortOrder");
    });

    it("strict isActive coercion", () => {
        const t = adminListServicesQuerySchema.safeParse({ isActive: "true" });
        const f = adminListServicesQuerySchema.safeParse({ isActive: "false" });
        expect(t.success && t.data.isActive).toBe(true);
        expect(f.success && f.data.isActive).toBe(false);
    });

    it("rejects junk isActive string", () => {
        expect(adminListServicesQuerySchema.safeParse({ isActive: "yes" }).success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Piercer profile
// ---------------------------------------------------------------------------
describe("updatePiercerProfileSchema", () => {
    it("accepts an empty patch (singleton PATCH semantics)", () => {
        expect(updatePiercerProfileSchema.safeParse({}).success).toBe(true);
    });

    it("trims and lower-bounds firstName length", () => {
        expect(updatePiercerProfileSchema.safeParse({ firstName: "  " }).success).toBe(false);
    });

    it("caps specializations array length", () => {
        const r = updatePiercerProfileSchema.safeParse({
            specializations: Array.from({ length: 31 }, (_v, i) => `spec_${i}`),
        });
        expect(r.success).toBe(false);
    });

    it("rejects non-URL avatarUrl", () => {
        expect(updatePiercerProfileSchema.safeParse({ avatarUrl: "not a url" }).success).toBe(
            false
        );
    });
});

// ---------------------------------------------------------------------------
// Weekly schedule
// ---------------------------------------------------------------------------
describe("weeklyDayScheduleSchema", () => {
    it("accepts a non-working day with no times", () => {
        const r = weeklyDayScheduleSchema.safeParse({ dayOfWeek: 6, isWorking: false });
        expect(r.success).toBe(true);
    });

    it("requires both times when isWorking", () => {
        const r = weeklyDayScheduleSchema.safeParse({
            dayOfWeek: 0,
            isWorking: true,
            startTime: "10:00",
        });
        expect(r.success).toBe(false);
    });

    it("rejects endTime <= startTime", () => {
        const r = weeklyDayScheduleSchema.safeParse({
            dayOfWeek: 0,
            isWorking: true,
            startTime: "19:00",
            endTime: "10:00",
        });
        expect(r.success).toBe(false);
    });

    it("rejects breaks outside the working window", () => {
        const r = weeklyDayScheduleSchema.safeParse({
            dayOfWeek: 0,
            isWorking: true,
            startTime: "10:00",
            endTime: "19:00",
            breaks: [{ start: "20:00", end: "21:00" }],
        });
        expect(r.success).toBe(false);
    });

    it("rejects overlapping breaks", () => {
        const r = weeklyDayScheduleSchema.safeParse({
            dayOfWeek: 0,
            isWorking: true,
            startTime: "10:00",
            endTime: "19:00",
            breaks: [
                { start: "13:00", end: "14:00" },
                { start: "13:30", end: "14:30" },
            ],
        });
        expect(r.success).toBe(false);
    });

    it("accepts well-formed breaks (lunch + tea)", () => {
        const r = weeklyDayScheduleSchema.safeParse({
            dayOfWeek: 0,
            isWorking: true,
            startTime: "10:00",
            endTime: "19:00",
            breaks: [
                { start: "13:00", end: "14:00" },
                { start: "16:30", end: "16:45" },
            ],
        });
        expect(r.success).toBe(true);
    });

    it("rejects out-of-range dayOfWeek", () => {
        expect(weeklyDayScheduleSchema.safeParse({ dayOfWeek: 7, isWorking: false }).success).toBe(
            false
        );
    });

    it("rejects malformed time string", () => {
        expect(
            weeklyDayScheduleSchema.safeParse({
                dayOfWeek: 0,
                isWorking: true,
                startTime: "25:00",
                endTime: "26:00",
            }).success
        ).toBe(false);
    });
});

describe("replaceWeeklyScheduleSchema", () => {
    it("rejects duplicate dayOfWeek entries", () => {
        const r = replaceWeeklyScheduleSchema.safeParse({
            days: [
                { dayOfWeek: 0, isWorking: false },
                { dayOfWeek: 0, isWorking: false },
            ],
        });
        expect(r.success).toBe(false);
    });

    it("accepts a single-day patch", () => {
        const r = replaceWeeklyScheduleSchema.safeParse({
            days: [{ dayOfWeek: 0, isWorking: false }],
        });
        expect(r.success).toBe(true);
    });

    it("rejects more than 7 entries", () => {
        const r = replaceWeeklyScheduleSchema.safeParse({
            days: Array.from({ length: 8 }, (_v, i) => ({ dayOfWeek: i % 7, isWorking: false })),
        });
        expect(r.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Schedule exceptions
// ---------------------------------------------------------------------------
describe("createScheduleExceptionSchema", () => {
    it("accepts a non-working day-off with reason only", () => {
        expect(
            createScheduleExceptionSchema.safeParse({
                date: "2026-01-07",
                isWorking: false,
                reason: "Рождество",
            }).success
        ).toBe(true);
    });

    it("requires both times for a working exception", () => {
        const r = createScheduleExceptionSchema.safeParse({
            date: "2026-05-09",
            isWorking: true,
            startTime: "12:00",
        });
        expect(r.success).toBe(false);
    });

    it("rejects endTime <= startTime", () => {
        const r = createScheduleExceptionSchema.safeParse({
            date: "2026-05-09",
            isWorking: true,
            startTime: "12:00",
            endTime: "12:00",
        });
        expect(r.success).toBe(false);
    });

    it("rejects malformed date", () => {
        const r = createScheduleExceptionSchema.safeParse({
            date: "07/01/2026",
            isWorking: false,
        });
        expect(r.success).toBe(false);
    });
});

describe("updateScheduleExceptionSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateScheduleExceptionSchema.safeParse({}).success).toBe(true);
    });
});

describe("adminListScheduleExceptionsQuerySchema", () => {
    it("strict isWorking coercion", () => {
        const t = adminListScheduleExceptionsQuerySchema.safeParse({ isWorking: "true" });
        expect(t.success && t.data.isWorking).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Time blocks
// ---------------------------------------------------------------------------
describe("createTimeBlockSchema", () => {
    it("accepts a valid block", () => {
        expect(
            createTimeBlockSchema.safeParse({
                date: "2026-04-14",
                startTime: "13:00",
                endTime: "14:30",
            }).success
        ).toBe(true);
    });

    it("rejects endTime == startTime", () => {
        const r = createTimeBlockSchema.safeParse({
            date: "2026-04-14",
            startTime: "13:00",
            endTime: "13:00",
        });
        expect(r.success).toBe(false);
    });
});

describe("updateTimeBlockSchema", () => {
    it("accepts an empty patch", () => {
        expect(updateTimeBlockSchema.safeParse({}).success).toBe(true);
    });
});

describe("adminListTimeBlocksQuerySchema", () => {
    it("accepts both range and single-date forms", () => {
        expect(
            adminListTimeBlocksQuerySchema.safeParse({
                from: "2026-04-01",
                to: "2026-04-30",
            }).success
        ).toBe(true);
        expect(adminListTimeBlocksQuerySchema.safeParse({ date: "2026-04-14" }).success).toBe(true);
    });
});
