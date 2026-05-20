/**
 * Integration test — aftercare 7-step migration.
 *
 * Validates: Requirements 4.4, 4.5, 4.8, 4.9, 4.11, 9.2, 9.3, 9.4
 *
 * Uses real DB for customer, aftercare_tracking, and notification_log rows.
 * Mocks BullMQ producers, Redis, Resend, Telegram, and PostHog at the
 * module boundary so no external services are touched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { db, aftercareTracking, customers, notificationLogs } from "@/db";
import { makeTestTag } from "@/test/integration/helpers";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ id: "msg_ac_int" })));
const notifyAftercareStepMock = vi.hoisted(() => vi.fn(async () => true));
const enqueueAftercareStepMock = vi.hoisted(() => vi.fn(async () => undefined));
const redisDelMock = vi.hoisted(() => vi.fn(async () => 1));
const redisZremMock = vi.hoisted(() => vi.fn(async () => 1));
const getAftercareSettingsMock = vi.hoisted(() =>
    vi.fn(async () => ({ maxDays: 90, downsizePiercingTypes: ["ear"] }))
);

vi.mock("@/lib/resend", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/lib/telegram/notifications", () => ({
    notifyAftercareStep: notifyAftercareStepMock,
}));
vi.mock("@/lib/posthog", () => ({ capture: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: { del: redisDelMock, zrem: redisZremMock } }));
vi.mock("@/lib/settings", () => ({ getAftercareSettings: getAftercareSettingsMock }));
vi.mock("@/lib/queue", async () => {
    const actual = await vi.importActual<typeof import("@/lib/queue")>("@/lib/queue");
    return { ...actual, enqueueAftercareStep: enqueueAftercareStepMock };
});

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import { enqueueAftercareDrip, sendAftercareStepIfDue } from "@/lib/aftercare/reminders";
import { AFTERCARE_STEPS, STEP_OFFSET_DAYS, aftercareStepFireUtc } from "@/lib/aftercare/time";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const tag = makeTestTag("ac-mig");
const PIERCING_DATE = "2026-05-14";
let customerId: string;
let trackingId: string;

beforeAll(async () => {
    const [c] = await db
        .insert(customers)
        .values({ email: `${tag}@test.local`, firstName: tag })
        .returning({ id: customers.id });
    customerId = c.id;

    const [t] = await db
        .insert(aftercareTracking)
        .values({
            customerId,
            appointmentId: null,
            piercingType: "helix",
            piercingDate: PIERCING_DATE,
            isActive: true,
        })
        .returning({ id: aftercareTracking.id });
    trackingId = t.id;
});

afterAll(async () => {
    await db
        .delete(notificationLogs)
        .where(sql`${notificationLogs.metadata} ->> 'trackingId' = ${trackingId}`);
    await db.delete(aftercareTracking).where(eq(aftercareTracking.id, trackingId));
    await db.delete(customers).where(eq(customers.id, customerId));
});

beforeEach(() => {
    enqueueAftercareStepMock.mockClear();
    sendEmailMock.mockClear().mockResolvedValue({ id: "msg_ac_int" });
    notifyAftercareStepMock.mockClear().mockResolvedValue(true);
    getAftercareSettingsMock.mockClear().mockResolvedValue({
        maxDays: 90,
        downsizePiercingTypes: ["ear"],
    });
});

// ===========================================================================
// enqueueAftercareDrip — varied now + maxDays
// ===========================================================================
describe("enqueueAftercareDrip — integration", () => {
    it("schedules all 7 steps when now is the day of piercing", async () => {
        const now = new Date("2026-05-14T12:00:00Z");
        const result = await enqueueAftercareDrip(
            { id: trackingId, appointmentId: null, customerId, piercingDate: PIERCING_DATE },
            now
        );
        expect(result.scheduled).toHaveLength(7);
        expect(result.scheduled).toEqual(AFTERCARE_STEPS);
        expect(enqueueAftercareStepMock).toHaveBeenCalledTimes(7);
    });

    it("skips past steps when now is 18 days after piercing", async () => {
        const now = new Date("2026-06-01T12:00:00Z"); // +18 days
        const result = await enqueueAftercareDrip(
            { id: trackingId, appointmentId: null, customerId, piercingDate: PIERCING_DATE },
            now
        );
        // day1(+1), day3(+3), day7(+7), day14(+14) fire at 06:00 UTC on their
        // respective dates — all before 2026-06-01T12:00Z. Only day30, day60,
        // day90 remain.
        expect(result.scheduled).toEqual(["day30", "day60", "day90"]);
        expect(result.skipped).toContain("day1");
        expect(result.skipped).toContain("day14");
    });

    it("respects maxDays=30 — only schedules steps with offset ≤ 30", async () => {
        getAftercareSettingsMock.mockResolvedValue({ maxDays: 30, downsizePiercingTypes: [] });
        const now = new Date("2026-05-14T12:00:00Z");
        const result = await enqueueAftercareDrip(
            { id: trackingId, appointmentId: null, customerId, piercingDate: PIERCING_DATE },
            now
        );
        const expected = AFTERCARE_STEPS.filter((s) => STEP_OFFSET_DAYS[s] <= 30);
        expect(result.scheduled).toEqual(expected);
        expect(result.skipped).toContain("day60");
        expect(result.skipped).toContain("day90");
    });
});

// ===========================================================================
// sendAftercareStepIfDue — dispatch + idempotency
// ===========================================================================
describe("sendAftercareStepIfDue — integration", () => {
    it("dispatches email + telegram for a due step and creates notification_log rows", async () => {
        const now = new Date("2027-01-01T12:00:00Z"); // far future — all steps due
        const result = await sendAftercareStepIfDue(trackingId, "day1", now);

        expect(result.sent).toBe(true);
        expect(result.emailSent).toBe(true);
        expect(result.telegramSent).toBe(true);
        expect(sendEmailMock).toHaveBeenCalledTimes(1);
        expect(notifyAftercareStepMock).toHaveBeenCalledTimes(1);

        // Verify notification_log row was created in the real DB.
        const logs = await db
            .select({ channel: notificationLogs.channel, type: notificationLogs.type })
            .from(notificationLogs)
            .where(
                and(
                    eq(notificationLogs.type, "aftercare_day1"),
                    eq(notificationLogs.status, "sent"),
                    sql`${notificationLogs.metadata} ->> 'trackingId' = ${trackingId}`
                )
            );
        expect(logs.some((l) => l.channel === "email")).toBe(true);
    });

    it("re-invocation returns already_sent and produces no duplicate rows", async () => {
        const now = new Date("2027-01-01T12:00:00Z");
        sendEmailMock.mockClear();
        notifyAftercareStepMock.mockClear();

        const result = await sendAftercareStepIfDue(trackingId, "day1", now);

        expect(result.sent).toBe(false);
        expect(result.skippedReason).toBe("already_sent");
        expect(sendEmailMock).not.toHaveBeenCalled();
        expect(notifyAftercareStepMock).not.toHaveBeenCalled();

        // Count remains 1.
        const logs = await db
            .select({ id: notificationLogs.id })
            .from(notificationLogs)
            .where(
                and(
                    eq(notificationLogs.type, "aftercare_day1"),
                    eq(notificationLogs.status, "sent"),
                    eq(notificationLogs.channel, "email"),
                    sql`${notificationLogs.metadata} ->> 'trackingId' = ${trackingId}`
                )
            );
        expect(logs).toHaveLength(1);
    });

    it("returns not_due_yet when fire instant is in the future", async () => {
        // day90 fires at piercingDate + 90d = 2026-08-12 06:00Z.
        // now = 2026-06-01 — well before that.
        const now = new Date("2026-06-01T12:00:00Z");
        const result = await sendAftercareStepIfDue(trackingId, "day90", now);
        expect(result.sent).toBe(false);
        expect(result.skippedReason).toBe("not_due_yet");
    });
});
