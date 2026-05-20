/**
 * Integration tests for `POST /api/booking/appointments` — the public
 * appointment creation endpoint. Imports the route handler directly and
 * calls it with synthetic `Request` objects (no HTTP server), per the
 * established convention under `src/app/api/**\/*.integration.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * Path note
 * ---------------------------------------------------------------------------
 *
 *   The design doc and tasks.md refer to the booking handler as
 *   `booking/route.ts`, but the actual route handler lives one level
 *   deeper at `./appointments/route.ts`. The test file path is
 *   `app/src/app/api/booking/route.integration.test.ts` per the task
 *   constraint; the import below points at the real implementation.
 *
 * ---------------------------------------------------------------------------
 * Scope (Phase 3, task 3.4 — example tests only)
 * ---------------------------------------------------------------------------
 *
 *   1. Happy path     — POST a valid `bookAppointmentSchema` payload,
 *                        expect 201 + body containing a `PK-APT-YYYY-NNNN`
 *                        reference number (Req 3.1).
 *   2. Slot collision — first POST succeeds; second POST for the same
 *                        date+time returns 409 + `error.code:
 *                        "slot_unavailable"` (Req 3.2, 3.5).
 *   3. Invalid body   — POST a payload missing `waiverSignatureData`,
 *                        expect 422 + `error.code: "validation_error"`
 *                        (Req 3.4).
 *   4. Row-count snapshot — captured in `beforeAll`, asserted unchanged in
 *                            `afterAll` after the local cleanup helper
 *                            runs (AC 3.8).
 *
 * ---------------------------------------------------------------------------
 * Mock surface
 * ---------------------------------------------------------------------------
 *
 *   `setup.ts` already mocks `@/lib/auth`, `@/lib/rate-limit`, and
 *   `@/lib/api` process-wide (see `src/test/integration/README.md` §5).
 *   Those mocks are inherited unchanged.
 *
 *   This file additionally hoists five route-specific mocks. The first
 *   two are load-bearing for the booking POST path; the remaining three
 *   are defensive (the booking route does not import them directly,
 *   but they are listed in the task brief and protect against future
 *   refactors that might pull them in transitively).
 *
 *   - `@/lib/booking/reminders` — overrides
 *      `enqueueAppointmentReminders` so the route's best-effort
 *      BullMQ enqueue does not actually require a live Redis. The
 *      route fires this with `void …catch(...)`, so a resolved no-op
 *      promise is sufficient. This is the load-bearing mock — without
 *      it, the test would hang waiting for a Redis connection.
 *   - `@/emails/dispatch` — overrides
 *      `sendAppointmentConfirmationEmail` so the route's fire-and-
 *      forget Resend send does not insert a `notification_log` row
 *      (no `ON DELETE CASCADE` on `notification_log.customer_id`,
 *      which would block the customer cleanup at the end of the run).
 *   - `@/lib/queue` — defensive stubs for the queue module. The
 *      booking route only reaches the queue layer via
 *      `@/lib/booking/reminders` (which is mocked above), so the real
 *      queue module never loads on this test path. Listed for
 *      symmetry with the reservations test and the task brief.
 *   - `@/lib/captcha/route-helpers` — defensive override of
 *      `isVerifyOk`. The current booking schema does NOT include a
 *      `captchaToken` field and the route does NOT call any captcha
 *      verifier, so this mock is a no-op today; included per the task
 *      brief and to mirror the reservations integration test pattern.
 *   - `@/lib/telegram/notifications` — defensive stub. The current
 *      booking POST does not push a Telegram notification at create
 *      time (only the cron + worker pathways do, via
 *      `notifyBookingReminder`). Listed for parity.
 */
import { count, eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./appointments/route";
import {
    appointmentJewelry,
    appointmentServices,
    appointments,
    customers,
    db,
    piercerSchedule,
    services,
    waiverTemplates,
    waivers,
} from "@/db";
import {
    buildRequest,
    expectRowCountUnchanged,
    makeTestTag,
    readResponse,
    snapshotWeeklySchedule,
} from "@/test/integration/helpers";

// ---------------------------------------------------------------------------
// Module mocks (route-specific)
// ---------------------------------------------------------------------------
//
// `vi.mock` calls are hoisted by Vitest to the top of the module, before
// any of the imports above are resolved. That is how the real
// `./appointments/route` import below sees the stubbed dependencies
// rather than the production modules.

vi.mock("@/lib/booking/reminders", () => ({
    // Route fires this with `void …catch(...)`. A resolved promise
    // matching the production return shape is sufficient — the route
    // does not inspect the resolved value.
    enqueueAppointmentReminders: vi.fn(async () => ({
        scheduled: [],
        skipped: [],
    })),
}));

vi.mock("@/emails/dispatch", () => ({
    // Route fires this with `void …catch(...)`. Returning `null`
    // matches the documented "skipped / failed" branch of the real
    // function and keeps `notification_log` clean.
    sendAppointmentConfirmationEmail: vi.fn(async () => null),
}));

vi.mock("@/lib/queue", () => ({
    // Defensive — the booking POST does not import `@/lib/queue`
    // directly, but the task brief mandates this mock for parity with
    // the reservations test surface.
    enqueueReservationExpiry: vi.fn(async () => undefined),
    enqueueBookingReminder: vi.fn(async () => undefined),
    QUEUE_NAMES: {
        reservationExpire: "reservation:expire",
        bookingReminder: "booking:reminder",
    },
}));

vi.mock("@/lib/captcha/route-helpers", async () => {
    const actual = await vi.importActual<typeof import("@/lib/captcha/route-helpers")>(
        "@/lib/captcha/route-helpers"
    );
    return {
        ...actual,
        // Defensive — current booking schema has no `captchaToken` field
        // and the route does not call the captcha verifier. Mock kept
        // for parity with the reservations test surface.
        isVerifyOk: vi.fn(() => true),
    };
});

vi.mock("@/lib/telegram/notifications", () => ({
    // Defensive — the booking POST does not currently dispatch a
    // Telegram notification at create time. Mock kept for parity with
    // the reservations test surface and as a guardrail against a
    // future refactor that might add one.
    notifyBookingReminder: vi.fn(async () => false),
    notifyReservationCreated: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Test fixtures and constants
// ---------------------------------------------------------------------------

/** Tag shared by every test in this file — single cleanup at `afterAll`. */
const tag = makeTestTag("p3-booking");

/**
 * Distinct customer emails per test scenario. The `${tag}` prefix carries
 * across so the `LIKE %tag%` cleanup picks all of them up regardless of
 * which tests actually executed (e.g. when one test threw mid-way).
 */
const happyPathEmail = `${tag}-happy@test.local`;
const collisionFirstEmail = `${tag}-coll-a@test.local`;
const collisionSecondEmail = `${tag}-coll-b@test.local`;

/**
 * Two distinct future dates so the happy-path appointment cannot
 * accidentally interfere with the collision-test fixtures. Both fall on
 * working days under our seeded schedule (every weekday is open below).
 *
 *   2027-06-01 (Tuesday  → dayOfWeek = 1)
 *   2027-06-02 (Wednesday → dayOfWeek = 2)
 *
 * The day-of-week math comes from `dayOfWeekForDate` in
 * `@/lib/booking/availability`: `(getUTCDay() + 6) % 7`.
 */
const HAPPY_PATH_DATE = "2027-06-01";
const COLLISION_DATE = "2027-06-02";
const SLOT_TIME = "10:00";

/**
 * Minimal but well-formed base64-PNG payload. The schema only requires
 * `min(1).max(2_000_000)`, so the exact contents do not matter — this
 * shape mirrors what the production form sends.
 */
const STUB_SIGNATURE =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

interface AppointmentResponseBody {
    appointment: {
        id: string;
        referenceNumber: string;
        status: string;
        date: string;
        timeStart: string;
        timeEnd: string;
        totalDurationMin: number;
        estimatedTotal: number;
        services: string[];
        customer: { id: string; email: string } | null;
        customerCreated: boolean;
        createdAt: string;
    };
}

interface ErrorBody {
    error: { code: string; message: string; details?: unknown };
}

// ---------------------------------------------------------------------------
// Local cleanup (extends `cleanupTaggedRows` per design §"Phase 3")
// ---------------------------------------------------------------------------
//
// `cleanupTaggedRows` covers `services`, but it does NOT cover the
// `appointment` / `waiver` / `customer` triple this test exercises.
// The challenge is the circular FK between `appointment.waiver_id` and
// `waiver.appointment_id` (neither side declares ON DELETE CASCADE in
// `app/src/db/schema/booking.ts`):
//
//   appointment ──waiverId──▶ waiver
//   appointment ◀──appointmentId── waiver
//
// To break the cycle we:
//   1. Locate the tagged appointments (via `customer_email LIKE %tag%`).
//   2. UPDATE appointments SET waiver_id = NULL — releases one side of
//      the FK so the waiver row can be removed without the appointment
//      blocking it.
//   3. DELETE waivers attached to those appointment ids.
//   4. DELETE the appointments — `appointment_service` and
//      `appointment_jewelry` cascade off `appointments.id` (both
//      declare `onDelete: "cascade"`).
//   5. DELETE tagged customers — guest appointments leave none, but the
//      seam is here for future tests that pass `createAccount: true`.
//   6. DELETE tagged services — covers the per-suite seeded service.

async function cleanupBookingRows(t: string): Promise<void> {
    const pattern = `%${t}%`;

    const taggedAppointments = await db
        .select({ id: appointments.id })
        .from(appointments)
        .where(like(appointments.customerEmail, pattern));
    const appointmentIds = taggedAppointments.map((row) => row.id);

    if (appointmentIds.length > 0) {
        // Step 2 — null out the waiver back-reference.
        await db
            .update(appointments)
            .set({ waiverId: null })
            .where(inArray(appointments.id, appointmentIds));

        // Step 3 — drop waivers attached to our appointments.
        await db.delete(waivers).where(inArray(waivers.appointmentId, appointmentIds));

        // Step 4 — appointments cascade to appointment_services +
        // appointment_jewelry via FK.
        await db.delete(appointments).where(inArray(appointments.id, appointmentIds));
    }

    // Step 5 — tagged customers (defensive; guest appointments don't
    // create customer rows when `createAccount` is omitted).
    await db.delete(customers).where(like(customers.email, pattern));

    // Step 6 — tagged services.
    await db.delete(services).where(like(services.handle, pattern));
}

// ---------------------------------------------------------------------------
// Row-count snapshot bookkeeping (AC 3.8)
// ---------------------------------------------------------------------------
//
// The tables below are the entire surface this file's seeding +
// the SUT touch:
//
//   - service / waiver_template                — fixture inserts
//   - appointment / appointment_service /
//     appointment_jewelry / waiver             — SUT inserts
//
// `customer` is intentionally absent from the snapshot. All three
// example tests use guest checkout (no `createAccount: true` on the
// payload, no authenticated session — `setup.ts` mocks `auth()` to
// return null), so the SUT's create path never inserts a `customer`
// row. Including `customer` here would expose the assertion to noise
// from other developers / processes hitting the shared dev DB during
// the test run, which is not the contract we're trying to verify.
// `cleanupBookingRows` still defensively deletes tagged customer rows
// so a future test that opts into account creation cannot leak.

type RowCounts = Record<string, number>;

async function snapshotRowCounts(): Promise<RowCounts> {
    const [
        [serviceCount],
        [appointmentCount],
        [appointmentServiceCount],
        [appointmentJewelryCount],
        [waiverCount],
        [waiverTemplateCount],
    ] = await Promise.all([
        db.select({ n: count() }).from(services),
        db.select({ n: count() }).from(appointments),
        db.select({ n: count() }).from(appointmentServices),
        db.select({ n: count() }).from(appointmentJewelry),
        db.select({ n: count() }).from(waivers),
        db.select({ n: count() }).from(waiverTemplates),
    ]);
    return {
        service: serviceCount.n,
        appointment: appointmentCount.n,
        appointment_service: appointmentServiceCount.n,
        appointment_jewelry: appointmentJewelryCount.n,
        waiver: waiverCount.n,
        waiver_template: waiverTemplateCount.n,
    };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("POST /api/booking/appointments integration", () => {
    let snapshotBefore: RowCounts;
    let restoreSchedule: () => Promise<void>;
    let serviceId: string;
    /**
     * Track whether THIS suite inserted a waiver template. The seed at
     * `src/db/seed.ts` already creates `version: 1, isActive: true`, so
     * on a seeded dev DB this stays `null`; on a fresh DB we insert one
     * with a unique high version and clean it up in `afterAll`.
     */
    let insertedWaiverTemplateVersion: number | null = null;

    beforeAll(async () => {
        snapshotBefore = await snapshotRowCounts();

        // Snapshot + override the weekly schedule. The restore at
        // `afterAll` brings it back exactly so other test files (and
        // the dev app) see the seeded shape.
        restoreSchedule = await snapshotWeeklySchedule();
        await db.delete(piercerSchedule);
        await db.insert(piercerSchedule).values(
            Array.from({ length: 7 }, (_, i) => ({
                dayOfWeek: i,
                isWorking: true,
                startTime: "09:00",
                endTime: "19:00",
                breaks: [],
            }))
        );

        // Seed a tagged active service. `services.handle` carries the
        // tag so the cleanup helper picks it up via `LIKE %tag%`.
        const [insertedService] = await db
            .insert(services)
            .values({
                name: `Test Service ${tag}`,
                handle: `${tag}-svc`,
                category: "new_piercing",
                subcategory: "ear",
                durationMinutes: 30,
                priceFrom: 500_000, // 5 000 ₽ in kopecks
                isActive: true,
            })
            .returning({ id: services.id });
        serviceId = insertedService.id;

        // Ensure at least one active waiver template exists. The seed
        // already creates `version: 1` active, so this branch is
        // typically a no-op; on a freshly-migrated DB it inserts a
        // unique high-version row that we clean up in `afterAll`.
        const [existingTemplate] = await db
            .select({ version: waiverTemplates.version })
            .from(waiverTemplates)
            .where(eq(waiverTemplates.isActive, true))
            .limit(1);
        if (!existingTemplate) {
            const version = 9_000_000 + Math.floor(Math.random() * 100_000);
            await db.insert(waiverTemplates).values({
                version,
                content: `Test waiver content (${tag})`,
                isActive: true,
            });
            insertedWaiverTemplateVersion = version;
        }
    });

    afterAll(async () => {
        // Idempotent — safe even if a test threw mid-way and never
        // produced any of the rows the helper deletes.
        await cleanupBookingRows(tag);

        if (insertedWaiverTemplateVersion !== null) {
            await db
                .delete(waiverTemplates)
                .where(eq(waiverTemplates.version, insertedWaiverTemplateVersion));
        }

        await restoreSchedule();

        const snapshotAfter = await snapshotRowCounts();
        expectRowCountUnchanged(snapshotBefore, snapshotAfter);
    });

    beforeEach(() => {
        // Reset the dispatched-mock call counts so per-test assertions
        // (none today, but a future Property test might add some) are
        // self-contained.
        vi.clearAllMocks();
    });

    // -------------------------------------------------------------------
    // Happy path (Req 3.1)
    // -------------------------------------------------------------------
    //
    // Posts a valid `bookAppointmentSchema` payload and asserts:
    //   - HTTP 201
    //   - `appointment.referenceNumber` matches `PK-APT-YYYY-NNNN`
    //     (`nextReferenceNumber("APT", …)` formats this way; see
    //     `app/src/lib/reference-numbers.ts`)
    //   - `appointment.status === "pending"`
    //   - `appointment.timeStart === "10:00"` and the route computed
    //     `timeEnd` from the seeded service duration (30 min) →
    //     `"10:30"`
    it("creates a pending appointment on the happy path (Req 3.1)", async () => {
        const res = await POST(
            buildRequest("/api/booking/appointments", "POST", {
                body: {
                    serviceIds: [serviceId],
                    date: HAPPY_PATH_DATE,
                    time: SLOT_TIME,
                    customer: {
                        firstName: "Тест",
                        lastName: tag,
                        email: happyPathEmail,
                        phone: "+70000000000",
                    },
                    waiverSigned: true,
                    waiverSignatureData: STUB_SIGNATURE,
                },
            })
        );
        const { status, json } = await readResponse<AppointmentResponseBody>(res);

        expect(status).toBe(201);
        expect(json.appointment.status).toBe("pending");
        // `nextReferenceNumber("APT", …)` formats as
        // `PK-APT-{YEAR}-{NNNN}` per `lib/reference-numbers.ts`.
        expect(json.appointment.referenceNumber).toMatch(/^PK-APT-\d{4}-\d{4}$/);
        expect(json.appointment.date).toBe(HAPPY_PATH_DATE);
        expect(json.appointment.timeStart).toMatch(/^10:00/);
        expect(json.appointment.timeEnd).toMatch(/^10:30/);
        expect(json.appointment.services).toContain(`Test Service ${tag}`);
    });

    // -------------------------------------------------------------------
    // Slot collision (Req 3.2, 3.5)
    // -------------------------------------------------------------------
    //
    // First POST seeds a `pending` appointment at the target slot. The
    // second POST for the same `(date, time)` should observe the busy
    // interval inside `createAppointment` (the `for("update")` lock
    // serialises the read), find the slot absent from `day.slots`, and
    // throw `AppointmentError("slot_unavailable")` — which the route
    // maps to HTTP 409 with `error.code: "slot_unavailable"`.
    it("returns 409 + slot_unavailable when the slot is already booked (Req 3.2, 3.5)", async () => {
        const firstRes = await POST(
            buildRequest("/api/booking/appointments", "POST", {
                body: {
                    serviceIds: [serviceId],
                    date: COLLISION_DATE,
                    time: SLOT_TIME,
                    customer: {
                        firstName: "Тест",
                        lastName: `${tag}-A`,
                        email: collisionFirstEmail,
                        phone: "+70000000000",
                    },
                    waiverSigned: true,
                    waiverSignatureData: STUB_SIGNATURE,
                },
            })
        );
        const first = await readResponse<AppointmentResponseBody>(firstRes);
        expect(first.status).toBe(201);

        const secondRes = await POST(
            buildRequest("/api/booking/appointments", "POST", {
                body: {
                    serviceIds: [serviceId],
                    date: COLLISION_DATE,
                    time: SLOT_TIME,
                    customer: {
                        firstName: "Тест",
                        lastName: `${tag}-B`,
                        email: collisionSecondEmail,
                        phone: "+70000000000",
                    },
                    waiverSigned: true,
                    waiverSignatureData: STUB_SIGNATURE,
                },
            })
        );
        const second = await readResponse<ErrorBody>(secondRes);

        expect(second.status).toBe(409);
        expect(second.json.error.code).toBe("slot_unavailable");
    });

    // -------------------------------------------------------------------
    // Invalid body (Req 3.4)
    // -------------------------------------------------------------------
    //
    // The booking schema requires `waiverSignatureData: string min 1`.
    // Omitting it short-circuits at `parseJson` → `validationFailed()`,
    // which maps to HTTP 422 + `error.code: "validation_error"` (the
    // lowercase `ErrorCode.Validation` constant from `@/lib/api`).
    //
    // The task brief allows 400 OR 422; the actual SUT path through
    // `parseJson` lands on 422 (Zod schema validation), so we assert
    // 422 explicitly — a future change to 400 (e.g. switching to a
    // different validation library) would be a deliberate break and
    // worth flagging via this test.
    it("returns 422 + validation_error when waiverSignatureData is missing (Req 3.4)", async () => {
        const res = await POST(
            buildRequest("/api/booking/appointments", "POST", {
                body: {
                    serviceIds: [serviceId],
                    date: HAPPY_PATH_DATE,
                    time: SLOT_TIME,
                    customer: {
                        firstName: "Тест",
                        lastName: tag,
                        email: `${tag}-invalid@test.local`,
                        phone: "+70000000000",
                    },
                    waiverSigned: true,
                    // waiverSignatureData intentionally omitted — Zod
                    // should reject this before the route reaches the
                    // domain layer.
                },
            })
        );
        const { status, json } = await readResponse<ErrorBody>(res);

        expect(status).toBe(422);
        expect(json.error.code).toBe("validation_error");
    });
});
