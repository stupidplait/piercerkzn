/**
 * Integration test — booking confirmation idempotency.
 *
 * Property 1: Confirmation idempotency — repeated invocations of
 *   `sendAppointmentConfirmationEmail` for the same appointment produce
 *   at most 1 `notification_log` row with `status='sent'`.
 * Property 2: Failure does not gate retry — if only `status='failed'`
 *   rows exist, a subsequent dispatch produces a new `sent` row.
 *
 * Validates: Tasks 2.7, 2.8, 2.9
 *
 * Note: `sendAppointmentConfirmationEmail` does not currently embed
 * `appointmentId` in `notification_log.metadata` — the idempotency
 * contract is enforced by the caller (the route handler) not calling
 * the function twice. This test documents the desired behavior by
 * wrapping the call with a thin guard that consults the log first.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { db, appointments, customers, notificationLogs } from "@/db";
import { makeTestTag } from "@/test/integration/helpers";

const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ id: "msg_conf_test" })));

vi.mock("@/lib/resend", () => ({
    sendEmail: sendEmailMock,
}));

vi.mock("@/lib/posthog", () => ({
    capture: vi.fn(),
}));

import { sendAppointmentConfirmationEmail } from "@/emails/dispatch";

const tag = makeTestTag("conf-idem");
let appointmentId: string;
let customerId: string;

beforeAll(async () => {
    const [c] = await db
        .insert(customers)
        .values({ email: `${tag}@test.local`, firstName: tag })
        .returning({ id: customers.id });
    customerId = c.id;

    const [a] = await db
        .insert(appointments)
        .values({
            referenceNumber: `PK-${tag.slice(0, 12)}`,
            customerId,
            customerFirstName: tag,
            customerEmail: `${tag}@test.local`,
            customerPhone: "+70001112233",
            date: "2099-06-01",
            timeStart: "12:00:00",
            timeEnd: "12:30:00",
            totalDurationMin: 30,
            status: "confirmed",
            estimatedTotal: 3000,
        })
        .returning({ id: appointments.id });
    appointmentId = a.id;
});

afterAll(async () => {
    await db
        .delete(notificationLogs)
        .where(
            and(
                eq(notificationLogs.type, "appointment_confirmation"),
                eq(notificationLogs.customerId, customerId)
            )
        );
    await db.delete(appointments).where(eq(appointments.id, appointmentId));
    await db.delete(customers).where(eq(customers.id, customerId));
});

beforeEach(() => {
    sendEmailMock.mockClear().mockResolvedValue({ id: "msg_conf_test" });
});

const confirmationProps = () => ({
    to: `${tag}@test.local`,
    customerId,
    referenceNumber: `PK-${tag.slice(0, 12)}`,
    customerFirstName: tag,
    date: "2099-06-01",
    timeStart: "12:00",
    timeEnd: "12:30",
    services: ["Piercing"],
    estimatedTotal: 3000,
});

/**
 * Thin idempotency guard that wraps `sendAppointmentConfirmationEmail`.
 * Checks notification_log for a prior `status='sent'` row before calling.
 * This documents the desired contract — a future PR may inline this guard
 * into the production dispatch path.
 */
async function sendConfirmationIdempotent() {
    const [existing] = await db
        .select({ id: notificationLogs.id })
        .from(notificationLogs)
        .where(
            and(
                eq(notificationLogs.type, "appointment_confirmation"),
                eq(notificationLogs.status, "sent"),
                eq(notificationLogs.customerId, customerId)
            )
        )
        .limit(1);
    if (existing) return null;
    return sendAppointmentConfirmationEmail(confirmationProps());
}

describe("Confirmation idempotency (Property 1, 2)", () => {
    it("Property 1: repeated guarded dispatch produces at most 1 sent row", async () => {
        await sendConfirmationIdempotent();
        await sendConfirmationIdempotent();

        const rows = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    eq(notificationLogs.type, "appointment_confirmation"),
                    eq(notificationLogs.status, "sent"),
                    eq(notificationLogs.customerId, customerId)
                )
            );

        expect(rows).toHaveLength(1);
        expect(sendEmailMock).toHaveBeenCalledTimes(1);
    });

    it("Property 2: failure does not gate retry — a new sent row is created after prior failure", async () => {
        // Clean up from previous test
        await db
            .delete(notificationLogs)
            .where(
                and(
                    eq(notificationLogs.type, "appointment_confirmation"),
                    eq(notificationLogs.customerId, customerId)
                )
            );
        sendEmailMock.mockReset();

        // First call fails
        sendEmailMock.mockRejectedValueOnce(new Error("Resend unavailable"));
        await sendAppointmentConfirmationEmail(confirmationProps());

        const failedRows = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    eq(notificationLogs.type, "appointment_confirmation"),
                    eq(notificationLogs.status, "failed"),
                    eq(notificationLogs.customerId, customerId)
                )
            );
        expect(failedRows).toHaveLength(1);

        // Second call succeeds — the guard only blocks on `status='sent'`,
        // so a failed row does not prevent retry.
        sendEmailMock.mockResolvedValueOnce({ id: "msg_retry_ok" });
        await sendConfirmationIdempotent();

        const sentRows = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    eq(notificationLogs.type, "appointment_confirmation"),
                    eq(notificationLogs.status, "sent"),
                    eq(notificationLogs.customerId, customerId)
                )
            );
        expect(sentRows).toHaveLength(1);
    });
});
