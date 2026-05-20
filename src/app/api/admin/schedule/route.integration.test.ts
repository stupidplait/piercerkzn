/**
 * Integration tests for the weekly schedule upsert at `/api/admin/schedule`.
 *
 * The `piercer_schedule` table is unique on `dayOfWeek` and seeded with
 * exactly 7 rows. We snapshot the live state before any mutation and
 * restore it in `afterAll` so subsequent tests / live data stay intact.
 *
 * Covers:
 *   - GET always returns 7 days, normalised, including labels.
 *   - PUT atomic upsert across multiple weekdays in a single transaction.
 *   - Schema-layer validation of break windows (overlap rejected, breaks
 *     outside startTime/endTime rejected).
 *   - Rejection of duplicate `dayOfWeek` entries in the payload.
 */
import { afterAll, describe, expect, it } from "vitest";

import { GET, PUT } from "./route";

import { buildRequest, readResponse, snapshotWeeklySchedule } from "@/test/integration/helpers";

interface DayRow {
    id: string | null;
    dayOfWeek: number;
    label: string;
    isWorking: boolean;
    startTime: string | null;
    endTime: string | null;
    breaks: { start: string; end: string }[];
}
interface ScheduleGetResponse {
    days: DayRow[];
}
interface SchedulePutResponse {
    days: DayRow[];
    count: number;
    mode: "upsert";
}
interface ErrorBody {
    error: { code: string; message: string };
}

let restore: (() => Promise<void>) | undefined;
afterAll(async () => {
    if (restore) await restore();
});

describe("/api/admin/schedule", () => {
    it("GET returns 7 normalised days with Russian labels", async () => {
        restore = await snapshotWeeklySchedule();
        const res = await GET();
        const body = await readResponse<ScheduleGetResponse>(res);
        expect(body.status).toBe(200);
        expect(body.json.days).toHaveLength(7);
        body.json.days.forEach((d, i) => {
            expect(d.dayOfWeek).toBe(i);
            expect(d.label).toBeTruthy();
            expect(Array.isArray(d.breaks)).toBe(true);
        });
    });

    it("PUT upserts multiple days in a single transaction", async () => {
        // Snapshot is already captured by the previous test's restore hook.
        const put = await PUT(
            buildRequest("/api/admin/schedule", "PUT", {
                body: {
                    days: [
                        {
                            dayOfWeek: 0,
                            isWorking: true,
                            startTime: "10:00",
                            endTime: "18:00",
                            breaks: [{ start: "13:00", end: "14:00" }],
                        },
                        { dayOfWeek: 6, isWorking: false },
                    ],
                },
            })
        );
        const body = await readResponse<SchedulePutResponse>(put);
        expect(body.status).toBe(200);
        expect(body.json.count).toBe(2);

        // Round-trip through GET to confirm both days landed.
        const get = await GET();
        const after = await readResponse<ScheduleGetResponse>(get);
        const monday = after.json.days.find((d) => d.dayOfWeek === 0)!;
        expect(monday.isWorking).toBe(true);
        expect(monday.startTime).toMatch(/^10:00(:00)?$/);
        expect(monday.endTime).toMatch(/^18:00(:00)?$/);
        expect(monday.breaks).toHaveLength(1);
        const sunday = after.json.days.find((d) => d.dayOfWeek === 6)!;
        expect(sunday.isWorking).toBe(false);
        expect(sunday.startTime).toBeNull();
        expect(sunday.endTime).toBeNull();
    });

    it("PUT rejects breaks that fall outside the working window", async () => {
        const put = await PUT(
            buildRequest("/api/admin/schedule", "PUT", {
                body: {
                    days: [
                        {
                            dayOfWeek: 1,
                            isWorking: true,
                            startTime: "10:00",
                            endTime: "12:00",
                            // Break ends after endTime.
                            breaks: [{ start: "11:00", end: "13:00" }],
                        },
                    ],
                },
            })
        );
        const body = await readResponse<ErrorBody>(put);
        expect(body.status).toBe(422);
        expect(body.json.error.code).toBe("validation_error");
    });

    it("PUT rejects overlapping breaks", async () => {
        const put = await PUT(
            buildRequest("/api/admin/schedule", "PUT", {
                body: {
                    days: [
                        {
                            dayOfWeek: 2,
                            isWorking: true,
                            startTime: "09:00",
                            endTime: "18:00",
                            breaks: [
                                { start: "12:00", end: "13:00" },
                                { start: "12:30", end: "13:30" },
                            ],
                        },
                    ],
                },
            })
        );
        const body = await readResponse<ErrorBody>(put);
        expect(body.status).toBe(422);
        expect(body.json.error.code).toBe("validation_error");
    });

    it("PUT rejects duplicate dayOfWeek in the payload", async () => {
        const put = await PUT(
            buildRequest("/api/admin/schedule", "PUT", {
                body: {
                    days: [
                        { dayOfWeek: 3, isWorking: false },
                        { dayOfWeek: 3, isWorking: false },
                    ],
                },
            })
        );
        const body = await readResponse<ErrorBody>(put);
        expect(body.status).toBe(422);
        expect(body.json.error.code).toBe("validation_error");
    });
});
