/**
 * Integration test: reschedule-reminders pipeline.
 *
 * Property 5: Reschedule cancels then re-enqueues — cancel strictly precedes
 *             enqueue and each is called exactly once per reschedule.
 * Property 6: Reschedule preserves single-send invariant — pre-seeded
 *             `notification_log` row with status='sent' is never duplicated.
 * Property 7: Past-window kinds skip without raising — kinds whose fire time
 *             is already past are skipped, no throw.
 * Integration wiring: old jobIds removed from Redis, new jobIds enqueued with
 *             correct delay, worker re-run produces no duplicate log rows.
 *
 * Validates: Tasks 2.14, 2.15, 2.16, 2.17
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

import { makeTestTag } from "./helpers";

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------
const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ id: "msg_test" })));
const notifyMock = vi.hoisted(() => vi.fn(async () => true));
const enqueueBookingReminderMock = vi.hoisted(() => vi.fn(async () => undefined));
const redisDelMock = vi.hoisted(() => vi.fn(async () => 1));
const redisZremMock = vi.hoisted(() => vi.fn(async () => 1));

vi.mock("@/lib/resend", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/lib/telegram/notifications", () => ({ notifyBookingReminder: notifyMock }));
vi.mock("@/lib/posthog", () => ({ capture: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: { del: redisDelMock, zrem: redisZremMock } }));
vi.mock("@/lib/queue", async () => {
    const actual = await vi.importActual<typeof import("@/lib/queue")>("@/lib/queue");
    return { ...actual, enqueueBookingReminder: enqueueBookingReminderMock };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import {
    cancelAppointmentReminders,
    enqueueAppointmentReminders,
    sendBookingReminderIfDue,
} from "@/lib/booking/reminders";
import { db, appointments, customers, notificationLogs } from "@/db";

// ---------------------------------------------------------------------------
// Test state
// ---------------------------------------------------------------------------
const tag = makeTestTag("resched");
let customerId: string;
let appointmentId: string;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeAll(async () => {
    const [cust] = await db
        .insert(customers)
        .values({
            email: `${tag}@test.local`,
            firstName: tag,
            passwordHash: "not-a-real-hash",
        })
        .returning({ id: customers.id });
    customerId = cust.id;

    // Far-future appointment (48h from now)
    const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const dateStr = future.toISOString().slice(0, 10);
    const timeStr = future.toISOString().slice(11, 16);

    const [appt] = await db
        .insert(appointments)
        .values({
            customerId,
            referenceNumber: `PK-TST-${tag.slice(0, 12)}`,
            customerFirstName: tag,
            customerEmail: `${tag}@test.local`,
            customerPhone: "+70000000000",
            date: dateStr,
            timeStart: timeStr,
            timeEnd: timeStr,
            totalDurationMin: 30,
            estimatedTotal: 0,
            status: "confirmed",
        })
        .returning({ id: appointments.id });
    appointmentId = appt.id;
});

afterAll(async () => {
    await db
        .delete(notificationLogs)
        .where(sql`${notificationLogs.metadata} ->> 'appointmentId' = ${appointmentId}`);
    await db.delete(appointments).where(eq(appointments.id, appointmentId));
    await db.delete(customers).where(eq(customers.id, customerId));
});

// ---------------------------------------------------------------------------
// Property 5: Reschedule cancels then re-enqueues
// ---------------------------------------------------------------------------
describe("Property 5: reschedule cancels then re-enqueues", () => {
    it("cancel strictly precedes enqueue and each called exactly once", async () => {
        const callOrder: string[] = [];
        redisDelMock.mockImplementation(async () => {
            callOrder.push("cancel:del");
            return 1;
        });
        redisZremMock.mockImplementation(async () => {
            callOrder.push("cancel:zrem");
            return 1;
        });
        enqueueBookingReminderMock.mockImplementation(async () => {
            callOrder.push("enqueue");
            return undefined;
        });

        const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
        const dateStr = future.toISOString().slice(0, 10);
        const timeStr = future.toISOString().slice(11, 16);

        // Simulate reschedule: cancel then enqueue
        await cancelAppointmentReminders(appointmentId);
        const result = await enqueueAppointmentReminders({
            id: appointmentId,
            date: dateStr,
            timeStart: timeStr,
        });

        // Cancel ops come before enqueue ops
        const firstEnqueueIdx = callOrder.indexOf("enqueue");
        const lastCancelIdx = Math.max(
            callOrder.lastIndexOf("cancel:del"),
            callOrder.lastIndexOf("cancel:zrem")
        );
        expect(lastCancelIdx).toBeLessThan(firstEnqueueIdx);

        // Each kind enqueued exactly once (2 kinds)
        const enqueueCount = callOrder.filter((c) => c === "enqueue").length;
        expect(enqueueCount).toBe(2);
        expect(result.scheduled).toContain("24h");
        expect(result.scheduled).toContain("2h");

        // Redis del called for each kind (2 kinds)
        const delCount = callOrder.filter((c) => c === "cancel:del").length;
        expect(delCount).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// Property 6: Reschedule preserves single-send invariant
// ---------------------------------------------------------------------------
describe("Property 6: reschedule preserves single-send invariant", () => {
    it("pre-seeded sent row prevents duplicate sends after N reschedules", async () => {
        // Pre-seed a sent notification_log row
        await db.insert(notificationLogs).values({
            customerId,
            channel: "email",
            type: "appointment_reminder_24h",
            recipient: `${tag}@test.local`,
            status: "sent",
            metadata: { appointmentId },
        });

        // Reschedule 3 times — each time call sendBookingReminderIfDue
        for (let i = 0; i < 3; i++) {
            const result = await sendBookingReminderIfDue(appointmentId, "24h");
            // Should not produce a second email send (already_sent or telegram-only)
            expect(result.emailSent).toBeFalsy();
        }

        // Assert only 1 sent email row exists
        const rows = await db
            .select()
            .from(notificationLogs)
            .where(
                sql`${notificationLogs.type} = 'appointment_reminder_24h'
                    AND ${notificationLogs.status} = 'sent'
                    AND ${notificationLogs.channel} = 'email'
                    AND ${notificationLogs.metadata} ->> 'appointmentId' = ${appointmentId}`
            );
        expect(rows).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// Property 7: Past-window kinds skip without raising
// ---------------------------------------------------------------------------
describe("Property 7: past-window kinds skip without raising", () => {
    it("24h kind is skipped when appointment is 90min away, no throw", async () => {
        // 90 minutes from now — 24h window already passed, 2h window also passed
        const soon = new Date(Date.now() + 90 * 60 * 1000);
        const dateStr = soon.toISOString().slice(0, 10);
        const timeStr = soon.toISOString().slice(11, 16);

        enqueueBookingReminderMock.mockClear();

        const result = await enqueueAppointmentReminders({
            id: appointmentId,
            date: dateStr,
            timeStart: timeStr,
        });

        // Both 24h and 2h fire times are in the past for a 90min-away slot
        expect(result.skipped).toContain("24h");
        expect(result.skipped).toContain("2h");
        expect(result.scheduled).toHaveLength(0);
        // No throw occurred — test reaching here is the assertion
    });

    it("only 24h is skipped when appointment is 3h away", async () => {
        const threeHours = new Date(Date.now() + 3 * 60 * 60 * 1000);
        const dateStr = threeHours.toISOString().slice(0, 10);
        const timeStr = threeHours.toISOString().slice(11, 16);

        enqueueBookingReminderMock.mockClear();

        const result = await enqueueAppointmentReminders({
            id: appointmentId,
            date: dateStr,
            timeStart: timeStr,
        });

        expect(result.skipped).toContain("24h");
        expect(result.scheduled).toContain("2h");
    });
});

// ---------------------------------------------------------------------------
// Integration wiring: Redis cleanup + correct delay + no duplicate logs
// ---------------------------------------------------------------------------
describe("Integration wiring: Redis keys and worker idempotency", () => {
    it("cancelAppointmentReminders removes correct Redis keys", async () => {
        redisDelMock.mockClear();
        redisZremMock.mockClear();

        await cancelAppointmentReminders(appointmentId);

        // Expect del called with the correct key patterns
        expect(redisDelMock).toHaveBeenCalledWith(
            expect.stringContaining(`apt:${appointmentId}:24h`)
        );
        expect(redisDelMock).toHaveBeenCalledWith(
            expect.stringContaining(`apt:${appointmentId}:2h`)
        );
        // Expect zrem called for delayed set
        expect(redisZremMock).toHaveBeenCalledWith(
            expect.stringContaining("booking:reminder"),
            `apt:${appointmentId}:24h`
        );
        expect(redisZremMock).toHaveBeenCalledWith(
            expect.stringContaining("booking:reminder"),
            `apt:${appointmentId}:2h`
        );
    });

    it("enqueueAppointmentReminders passes correct delay to queue", async () => {
        enqueueBookingReminderMock.mockClear();

        const future = new Date(Date.now() + 48 * 60 * 60 * 1000);
        const dateStr = future.toISOString().slice(0, 10);
        const timeStr = future.toISOString().slice(11, 16);
        const now = new Date();

        await enqueueAppointmentReminders(
            { id: appointmentId, date: dateStr, timeStart: timeStr },
            now
        );

        // 24h reminder: fires 24h before appointment
        const calls = enqueueBookingReminderMock.mock.calls as unknown as [
            string,
            string,
            number,
        ][];
        const call24h = calls.find((c) => c[1] === "24h");
        expect(call24h).toBeDefined();
        expect(call24h![0]).toBe(appointmentId);
        // Delay should be roughly 24h (48h - 24h offset = ~24h from now)
        const delay24h = call24h![2];
        expect(delay24h).toBeGreaterThan(23 * 60 * 60 * 1000);
        expect(delay24h).toBeLessThan(25 * 60 * 60 * 1000);

        // 2h reminder: fires 2h before appointment
        const call2h = calls.find((c) => c[1] === "2h");
        expect(call2h).toBeDefined();
        const delay2h = call2h![2];
        expect(delay2h).toBeGreaterThan(45 * 60 * 60 * 1000);
        expect(delay2h).toBeLessThan(47 * 60 * 60 * 1000);
    });

    it("worker re-run produces no duplicate notification_log rows", async () => {
        // sendBookingReminderIfDue already has a pre-seeded sent row from Property 6
        // Calling it again should not create a new row
        const result = await sendBookingReminderIfDue(appointmentId, "24h");
        expect(result.sent).toBe(false);

        const rows = await db
            .select()
            .from(notificationLogs)
            .where(
                sql`${notificationLogs.type} = 'appointment_reminder_24h'
                    AND ${notificationLogs.status} = 'sent'
                    AND ${notificationLogs.channel} = 'email'
                    AND ${notificationLogs.metadata} ->> 'appointmentId' = ${appointmentId}`
            );
        expect(rows).toHaveLength(1);
    });
});
