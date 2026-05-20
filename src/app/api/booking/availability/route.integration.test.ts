/**
 * Integration tests for `GET /api/booking/availability` — the public,
 * date-range slot computation that composes `piercer_schedule`,
 * `schedule_exception`, `time_block`, and existing `appointment` rows
 * into a list of bookable start times per day. Imports the route handler
 * directly and calls it with synthetic `Request` objects (no HTTP server),
 * per the established admin-test convention under
 * `src/app/api/admin/**\/*.integration.test.ts` and the sibling Phase 3
 * route files (`products`, `looks`).
 *
 * Scope (Phase 3, task 3.3):
 *   1. Working day returns slots — snapshot the weekly schedule, force a
 *      known 09:00-18:00 window onto every day-of-week, query a future
 *      date, expect 200 + `days[0].isWorkingDay === true` + a non-empty
 *      `slots` array (Req 3.1, 3.2).
 *   2. Closed day returns empty — same weekly schedule, but layer a
 *      `schedule_exception` with `isWorking: false` over a future date.
 *      The exception replaces the weekly window wholesale (per the route
 *      handler), so `slots` must be empty and `isWorkingDay` must be
 *      `false` (Req 3.2).
 *   3. Existing appointment carves out a busy interval — seed a tagged
 *      `pending` appointment at 11:00-12:00 on a future date, GET
 *      availability for that date, assert "11:00" is NOT in `slots` (the
 *      appointment occupies that minute) AND that "10:00" IS in `slots`
 *      (the only-45-minutes-required default fits cleanly before the
 *      appointment, given the seeded `booking.slot_duration_minutes=30`
 *      + `booking.buffer_minutes=15`) (Req 3.2).
 *   4. Invalid date returns 422 + validation_error — request
 *      `startDate=invalid`, assert 422 + `error.code: "validation_error"`
 *      (Req 3.4 / 3.5).
 *
 * Param-name deviation note (matching actual SUT, not the brief):
 *   The task brief lists `?date=YYYY-MM-DD&serviceId=...`, but the live
 *   route at `app/src/app/api/booking/availability/route.ts` validates
 *   against `availabilityRouteQuerySchema`, which exposes
 *   `startDate` + `endDate` (a date *range* — the route returns
 *   `days: AvailabilityDay[]`) and `serviceIds` (CSV). I exercise
 *   `startDate=endDate=<one day>` to scope the response to a single day
 *   and skip `serviceIds` so the duration falls back to one slot
 *   (`slot_duration_minutes` + `buffer_minutes` = 30 + 15 = 45 min).
 *   The assertions target the same wire contract.
 *
 * 400 → 422 deviation note:
 *   The brief asks for "400/422 with `error.code: "validation_error"`".
 *   `parseQuery()` in `@/lib/api.ts` funnels Zod failures through
 *   `validationFailed()`, which always emits HTTP 422. I assert 422
 *   exactly (matches the SUT) rather than accepting either status.
 *
 * Schedule contamination defence (working-day test):
 *   The dev seed at `src/db/seed.ts` writes a recurring weekly schedule
 *   with `dayOfWeek=5` (Saturday by the Mon=0 convention) at
 *   `10:00-16:00` and `dayOfWeek=6` (Sunday) closed. Test #1 needs a
 *   working day-of-week that emits slots — but instead of trying to
 *   guess the system clock's day-of-week, we use
 *   `snapshotWeeklySchedule()` to capture the live state, then upsert a
 *   uniform `09:00-18:00` open window onto **all 7 days**. That makes
 *   every future date a working day under the test schedule, so the
 *   "today + N days" picks below don't have to coordinate with the
 *   real-world calendar. The snapshot is restored in `afterAll`.
 *
 * Date selection:
 *   `studioNow()` in the route reads the actual system clock in
 *   Europe/Moscow. Picking dates `today + 7 / 8 / 9` (studio-local) keeps
 *   each future query inside the seeded
 *   `booking.advance_days = 30` window AND outside the
 *   `booking.min_notice_hours = 2` "today" floor (so
 *   `earliestStartMin = 0` for our chosen days, simplifying slot maths).
 *   The three days are also far enough apart that none of them collides
 *   with another integration test's scratch dates (the admin schedule
 *   tests use `2099-…` dates exclusively).
 *
 * Cleanup
 * ---------------------------------------------------------------------------
 *   - `cleanupTaggedRows(tag)` already deletes
 *     `schedule_exception.reason LIKE %tag%` and
 *     `time_block.reason LIKE %tag%` (verified in `helpers.ts`), so the
 *     closed-day exception drops automatically. No `time_block` rows are
 *     seeded by this file.
 *   - `appointment` is NOT covered by `cleanupTaggedRows` (extending it
 *     is task 3.4's responsibility). This file performs an inline
 *     `DELETE FROM appointment WHERE customer_id = …` in `afterAll`
 *     before deleting the tagged customer, so the FK on
 *     `appointment.customer_id → customer.id` releases first.
 *   - `customer` is also not covered by `cleanupTaggedRows`; the inline
 *     `afterAll` removes the seeded customer by id.
 *   - `snapshotWeeklySchedule()` restores `piercer_schedule` to its
 *     pre-test state.
 *   - The `expectRowCountUnchanged` check at the end of `afterAll`
 *     compares **tagged** row counts only (rows whose natural-key
 *     columns match `%tag%`); a global `count()` would diverge under
 *     concurrent activity from other Phase 2/3 integration files that
 *     share the `customer` and `appointment` tables in the singleFork
 *     worker. Tagged-only counting matches the wishlist test pattern
 *     and gives the AC 3.8 invariant the suite actually asks for: every
 *     row this test inserted is gone by the end.
 *
 * Mock surface
 * ---------------------------------------------------------------------------
 *   `setup.ts` already mocks `@/lib/auth`, `@/lib/rate-limit`, and
 *   `@/lib/api` process-wide. The availability route uses `parseQuery` +
 *   `ok` + `fail` + `internal` from `@/lib/api`; `setup.ts`'s
 *   `vi.importActual` preserves those so validation behaviour is real.
 *   No file-local `vi.mock` calls are required.
 */
import { count, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "./route";
import { appointments, customers, db, piercerSchedule, scheduleExceptions, timeBlocks } from "@/db";
import {
    buildRequest,
    cleanupTaggedRows,
    createCustomerForReservation,
    expectRowCountUnchanged,
    makeTestTag,
    readResponse,
    snapshotWeeklySchedule,
} from "@/test/integration/helpers";

// ---------------------------------------------------------------------------
// Response / request shapes (mirror the route's `ok({...})` payload)
// ---------------------------------------------------------------------------

interface AvailabilityDay {
    date: string;
    isWorkingDay: boolean;
    slots: string[];
}

interface AvailabilityResponse {
    startDate: string;
    endDate: string;
    effectiveStartDate: string;
    effectiveEndDate: string;
    requiredDurationMin: number;
    slotStepMin: number;
    currentTime?: { date: string; time: string; tz: string };
    days: AvailabilityDay[];
}

interface ErrorBody {
    error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Test tag + dates
// ---------------------------------------------------------------------------

const tag = makeTestTag("p3-avail");

/**
 * Compute "today" as the studio-local (`Europe/Moscow`) date in
 * `YYYY-MM-DD`. Mirrors `studioNow()` in the route so date arithmetic on
 * the test side stays aligned with the SUT regardless of the runner's
 * own timezone (CI runs in UTC; local devs may not).
 */
function moscowToday(): string {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Moscow",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Add `days` whole calendar days to an ISO date in pure UTC. */
function addDaysIso(iso: string, days: number): string {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

const today = moscowToday();
const dateOpen = addDaysIso(today, 7); // happy path
const dateClosed = addDaysIso(today, 8); // closed-via-exception
const dateAppt = addDaysIso(today, 9); // appointment carve-out

// ---------------------------------------------------------------------------
// Row-count snapshot
// ---------------------------------------------------------------------------
//
// The integration suite runs files concurrently inside a single fork
// (`singleFork: true` only pins the worker; files inside still race),
// and other Phase 2/3 files (`reservations`, `wishlist`, `unsubscribe`,
// `appointments`-aware tests) insert into `customer` and `appointment`
// during their own beforeAll/afterAll. A bare global `count() FROM
// customer` snapshot would diverge under that concurrent activity even
// when this suite's cleanup is perfect — the wishlist file already
// solved this by snapshotting only **tagged** counts (rows whose
// natural-key columns match `%tag%`), and that's the pattern used here.
//
// The four counters track exactly the rows this suite owns:
//
//   - tagged_customer            — by `customer.first_name LIKE %tag%`
//                                  (this file passes `tag` as
//                                  `firstName` via
//                                  `createCustomerForReservation`)
//   - tagged_appointment         — by `appointment.customer_notes LIKE
//                                  %tag%` (the seed sets
//                                  `customer_notes = '${tag}-appt-fixture'`)
//   - tagged_schedule_exception  — by `schedule_exception.reason LIKE
//                                  %tag%`
//   - tagged_time_block          — by `time_block.reason LIKE %tag%`
//                                  (this file inserts none, included as
//                                  a defensive baseline)
//
// Before any test runs, all four tagged counts are `0`; after `afterAll`
// runs, every count must be `0` again. Net-zero on the rows this suite
// owns is the invariant Req 3.8 actually asks for.

type RowCounts = Record<string, number>;

async function snapshotTaggedRowCounts(): Promise<RowCounts> {
    const pattern = `%${tag}%`;
    const [
        [taggedCustomerCount],
        [taggedAppointmentCount],
        [taggedScheduleExceptionCount],
        [taggedTimeBlockCount],
    ] = await Promise.all([
        db.select({ n: count() }).from(customers).where(like(customers.firstName, pattern)),
        db
            .select({ n: count() })
            .from(appointments)
            .where(like(appointments.customerNotes, pattern)),
        db
            .select({ n: count() })
            .from(scheduleExceptions)
            .where(like(scheduleExceptions.reason, pattern)),
        db.select({ n: count() }).from(timeBlocks).where(like(timeBlocks.reason, pattern)),
    ]);
    return {
        tagged_customer: taggedCustomerCount.n,
        tagged_appointment: taggedAppointmentCount.n,
        tagged_schedule_exception: taggedScheduleExceptionCount.n,
        tagged_time_block: taggedTimeBlockCount.n,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("GET /api/booking/availability integration", () => {
    let restoreWeeklySchedule: (() => Promise<void>) | undefined;
    let snapshotBefore: RowCounts;
    let customerId = "";

    beforeAll(async () => {
        snapshotBefore = await snapshotTaggedRowCounts();

        // Force a uniform 09:00-18:00 open window onto every day-of-week.
        // `piercer_schedule.dayOfWeek` is unique, so we upsert per day.
        // The snapshot in `afterAll` restores the pre-test state.
        restoreWeeklySchedule = await snapshotWeeklySchedule();
        for (let dow = 0; dow < 7; dow++) {
            await db
                .insert(piercerSchedule)
                .values({
                    dayOfWeek: dow,
                    isWorking: true,
                    startTime: "09:00:00",
                    endTime: "18:00:00",
                    breaks: [],
                })
                .onConflictDoUpdate({
                    target: piercerSchedule.dayOfWeek,
                    set: {
                        isWorking: true,
                        startTime: "09:00:00",
                        endTime: "18:00:00",
                        breaks: [],
                    },
                });
        }

        // Tagged customer for the appointment FK target. The inline
        // afterAll cleanup deletes the appointment first, then this row.
        const customer = await createCustomerForReservation(tag);
        customerId = customer.id;

        // ----- Closed-day fixture -------------------------------------
        // schedule_exception with isWorking=false replaces the weekly
        // window wholesale on `dateClosed`. `cleanupTaggedRows(tag)`
        // deletes by `reason LIKE %tag%`, so the row drops automatically
        // in `afterAll`.
        await db.insert(scheduleExceptions).values({
            date: dateClosed,
            isWorking: false,
            startTime: null,
            endTime: null,
            reason: `${tag}-closed`,
        });

        // ----- Appointment-carve-out fixture --------------------------
        // 11:00-12:00 on `dateAppt`, `pending` status (counted by the
        // route's `notInArray(status, ["cancelled", "no_show"])` filter).
        // `totalDurationMin = 60` is purely informational here — the
        // route reads `timeStart`/`timeEnd` for the busy interval.
        await db.insert(appointments).values({
            referenceNumber: `PK-APT-TEST-${tag.slice(0, 8)}`,
            customerId,
            customerFirstName: tag,
            customerEmail: `${tag}@test.local`,
            customerPhone: "+70000000000",
            date: dateAppt,
            timeStart: "11:00:00",
            timeEnd: "12:00:00",
            totalDurationMin: 60,
            status: "pending",
            estimatedTotal: 0,
            customerNotes: `${tag}-appt-fixture`,
        });
    });

    afterAll(async () => {
        // Order matters: appointment.customer_id → customer.id has no
        // ON DELETE CASCADE, so the appointment row must drop before the
        // customer row.
        if (customerId) {
            await db.delete(appointments).where(eq(appointments.customerId, customerId));
            await db.delete(customers).where(eq(customers.id, customerId));
        }

        // Drops the schedule_exception row by `reason LIKE %tag%`.
        await cleanupTaggedRows(tag);

        // Restore the weekly schedule from the pre-test snapshot.
        if (restoreWeeklySchedule) await restoreWeeklySchedule();

        const snapshotAfter = await snapshotTaggedRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    // -------------------------------------------------------------------
    // 1. Happy path — working day returns slots (Req 3.1, 3.2)
    // -------------------------------------------------------------------
    it("returns 200 with non-empty slots on a working day (Req 3.1, 3.2)", async () => {
        const res = await GET(
            buildRequest("/api/booking/availability", "GET", {
                query: { startDate: dateOpen, endDate: dateOpen },
            })
        );
        const { status, json } = await readResponse<AvailabilityResponse>(res);

        expect(status).toBe(200);
        expect(json.startDate).toBe(dateOpen);
        expect(json.endDate).toBe(dateOpen);
        expect(Array.isArray(json.days)).toBe(true);
        expect(json.days).toHaveLength(1);

        const day = json.days[0];
        expect(day.date).toBe(dateOpen);
        expect(day.isWorkingDay).toBe(true);
        expect(day.slots.length).toBeGreaterThan(0);
        // Every slot is `HH:MM` and falls inside our 09:00-18:00 window.
        for (const slot of day.slots) {
            expect(slot).toMatch(/^\d{2}:\d{2}$/u);
            expect(slot >= "09:00").toBe(true);
            expect(slot < "18:00").toBe(true);
        }
    });

    // -------------------------------------------------------------------
    // 2. Closed day via schedule_exception returns empty slots (Req 3.2)
    // -------------------------------------------------------------------
    it("returns 200 with empty slots on a date overridden by an isWorking=false exception (Req 3.2)", async () => {
        const res = await GET(
            buildRequest("/api/booking/availability", "GET", {
                query: { startDate: dateClosed, endDate: dateClosed },
            })
        );
        const { status, json } = await readResponse<AvailabilityResponse>(res);

        expect(status).toBe(200);
        expect(json.days).toHaveLength(1);
        const day = json.days[0];
        expect(day.date).toBe(dateClosed);
        expect(day.isWorkingDay).toBe(false);
        expect(day.slots).toEqual([]);
    });

    // -------------------------------------------------------------------
    // 3. Existing appointment carves out a busy interval (Req 3.2)
    // -------------------------------------------------------------------
    //
    // With the seeded settings (`slot_duration_minutes=30`,
    // `buffer_minutes=15`), `requiredDurationMin = 30 + 15 = 45` and
    // `slotStepMin = 30`. The appointment occupies [11:00, 12:00). After
    // subtracting it from the [09:00, 18:00) window, free intervals are
    // [09:00, 11:00) and [12:00, 18:00). On the 30-min grid:
    //   - "10:00" fits  (10:00 + 45 = 10:45 ≤ 11:00) → present
    //   - "10:30" fails (10:30 + 45 = 11:15 > 11:00) → absent
    //   - "11:00" / "11:30" → absent (inside the busy interval)
    //   - "12:00" fits  (12:00 + 45 = 12:45 ≤ 18:00) → present
    //
    // Asserting "11:00 absent" + "10:00 / 12:00 present" gives a strong
    // signal that the appointment carved a hole AND that slots resume
    // afterwards, without coupling the test to the full slot list (which
    // would re-derive the entire `computeSlotsForDay` logic).
    it("excludes slots overlapping a pending appointment (Req 3.2)", async () => {
        const res = await GET(
            buildRequest("/api/booking/availability", "GET", {
                query: { startDate: dateAppt, endDate: dateAppt },
            })
        );
        const { status, json } = await readResponse<AvailabilityResponse>(res);

        expect(status).toBe(200);
        expect(json.days).toHaveLength(1);
        const day = json.days[0];
        expect(day.date).toBe(dateAppt);
        expect(day.isWorkingDay).toBe(true);

        const slotSet = new Set(day.slots);
        // Inside the appointment window — must be excluded.
        expect(slotSet.has("11:00")).toBe(false);
        expect(slotSet.has("11:30")).toBe(false);
        // Slots immediately before and after the appointment must remain
        // bookable, proving the carve-out is local rather than a
        // whole-day blackout.
        expect(slotSet.has("10:00")).toBe(true);
        expect(slotSet.has("12:00")).toBe(true);
    });

    // -------------------------------------------------------------------
    // 4. Invalid date → 422 + validation_error (Req 3.4, 3.5)
    // -------------------------------------------------------------------
    //
    // `availabilityRouteQuerySchema` requires `startDate` and `endDate`
    // to match `^\d{4}-\d{2}-\d{2}$`. "not-a-date" fails the regex, the
    // ZodError funnels through `parseQuery` → `validationFailed()` →
    // HTTP 422 + `error.code: "validation_error"`.
    it("rejects invalid startDate with 422 + validation_error (Req 3.4, 3.5)", async () => {
        const res = await GET(
            buildRequest("/api/booking/availability", "GET", {
                query: { startDate: "not-a-date", endDate: dateOpen },
            })
        );
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(422);
        expect(json.error.code).toBe("validation_error");
    });
});
