import { beforeAll, describe, it, expect, afterAll, vi } from "vitest";
import { db, customers, appointments, notificationLogs } from "@/db";
import { eq, sql } from "drizzle-orm";
import { makeTestTag } from "@/test/integration/helpers";

const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ id: "msg_test" })));
const notifyBookingReminderMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/lib/resend", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/lib/telegram/notifications", () => ({
    notifyBookingReminder: notifyBookingReminderMock,
}));
vi.mock("@/lib/posthog", () => ({ capture: vi.fn() }));

import { sendBookingReminderIfDue } from "@/lib/booking/reminders";

const tag = makeTestTag("reminder-unsub");
let customerId: string;
let appointmentId: string;

describe("reminder-unsubscribe: notificationEmail=false skips email, attempts telegram", () => {
    beforeAll(async () => {
        const [c] = await db
            .insert(customers)
            .values({
                email: `${tag}@test.local`,
                firstName: "Test",
                notificationEmail: false,
            })
            .returning({ id: customers.id });
        customerId = c.id;

        const [a] = await db
            .insert(appointments)
            .values({
                referenceNumber: `REF-${tag.slice(0, 10)}`,
                customerId,
                customerFirstName: "Test",
                customerEmail: `${tag}@test.local`,
                customerPhone: "+70000000000",
                date: "2099-06-01",
                timeStart: "12:00:00",
                timeEnd: "13:00:00",
                totalDurationMin: 60,
                status: "confirmed",
                estimatedTotal: 0,
            })
            .returning({ id: appointments.id });
        appointmentId = a.id;
    });

    afterAll(async () => {
        await db
            .delete(notificationLogs)
            .where(sql`${notificationLogs.metadata} ->> 'appointmentId' = ${appointmentId}`);
        await db.delete(appointments).where(eq(appointments.id, appointmentId));
        await db.delete(customers).where(eq(customers.id, customerId));
    });

    it("24h reminder: no email log, telegram attempted", async () => {
        // 23h before appointment at 2099-06-01 09:00 UTC
        const now = new Date("2099-05-31T10:00:00Z");

        await sendBookingReminderIfDue(appointmentId, "24h", now);

        const emailLogs = await db
            .select()
            .from(notificationLogs)
            .where(
                sql`${notificationLogs.metadata} ->> 'appointmentId' = ${appointmentId}
            AND ${notificationLogs.type} = 'appointment_reminder_24h'
            AND ${notificationLogs.channel} = 'email'`
            );

        expect(emailLogs).toHaveLength(0);
        expect(notifyBookingReminderMock).toHaveBeenCalled();
    });

    it("2h reminder: no email log, telegram attempted", async () => {
        notifyBookingReminderMock.mockClear();

        // 1.5h before appointment at 2099-06-01 09:00 UTC
        const now = new Date("2099-06-01T07:30:00Z");

        await sendBookingReminderIfDue(appointmentId, "2h", now);

        const emailLogs = await db
            .select()
            .from(notificationLogs)
            .where(
                sql`${notificationLogs.metadata} ->> 'appointmentId' = ${appointmentId}
            AND ${notificationLogs.type} = 'appointment_reminder_2h'
            AND ${notificationLogs.channel} = 'email'`
            );

        expect(emailLogs).toHaveLength(0);
        expect(notifyBookingReminderMock).toHaveBeenCalled();
    });
});
