import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { db, appointments, customers, notificationLogs } from "@/db";
import { and, eq, sql } from "drizzle-orm";
import {
    enqueueSatisfactionSurvey,
    sendSatisfactionSurveyIfDue,
    sweepDueSatisfactionSurveys,
} from "@/lib/satisfaction/reminders";
import { makeTestTag } from "@/test/integration/helpers";

const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ id: "msg_sat_test" })));
const enqueueSatisfactionSurveyQueueMock = vi.hoisted(() => vi.fn(async () => undefined));
const redisDelMock = vi.hoisted(() => vi.fn(async () => 1));
const redisZremMock = vi.hoisted(() => vi.fn(async () => 1));

vi.mock("@/lib/resend", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/lib/posthog", () => ({ capture: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: { del: redisDelMock, zrem: redisZremMock } }));
vi.mock("@/lib/queue", async () => {
    const actual = await vi.importActual<typeof import("@/lib/queue")>("@/lib/queue");
    return { ...actual, enqueueSatisfactionSurvey: enqueueSatisfactionSurveyQueueMock };
});

describe("Satisfaction survey integration", () => {
    const tag = makeTestTag();
    const completedAt = new Date("2026-05-14T13:00:00Z");
    const nowAfterDelay = new Date("2026-05-22T13:00:00Z"); // completedAt + 8 days

    let customerId: string;
    let appointmentId: string;
    const referenceNumber = `SAT-${tag}`;

    beforeAll(async () => {
        const [customer] = await db
            .insert(customers)
            .values({
                email: `${tag}@test.local`,
                firstName: "SatTest",
                notificationEmail: true,
            })
            .returning();
        customerId = customer.id;

        const [appointment] = await db
            .insert(appointments)
            .values({
                referenceNumber,
                customerId,
                customerFirstName: "SatTest",
                customerEmail: `${tag}@test.local`,
                customerPhone: "+70000000000",
                date: "2026-05-14",
                timeStart: "13:00",
                timeEnd: "14:00",
                totalDurationMin: 60,
                status: "completed",
                estimatedTotal: 0,
                completedAt,
            })
            .returning();
        appointmentId = appointment.id;
    });

    afterAll(async () => {
        await db
            .delete(notificationLogs)
            .where(sql`${notificationLogs.metadata}->>'appointmentId' = ${appointmentId}`);
        await db.delete(appointments).where(eq(appointments.id, appointmentId));
        await db.delete(customers).where(eq(customers.id, customerId));
    });

    it("enqueues satisfaction survey with correct scheduling", async () => {
        const appointment = {
            id: appointmentId,
            date: "2026-05-14",
            timeStart: "13:00",
            referenceNumber,
            customerId,
        };
        const result = await enqueueSatisfactionSurvey(appointment, completedAt, completedAt);

        expect(result.scheduled).toBe(true);
        expect(result.fireUtc).toBeInstanceOf(Date);
    });

    it("sends satisfaction survey when due", async () => {
        const result = await sendSatisfactionSurveyIfDue(appointmentId, nowAfterDelay);

        expect(result.sent).toBe(true);
        expect(sendEmailMock).toHaveBeenCalled();

        const rows = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    sql`${notificationLogs.metadata}->>'appointmentId' = ${appointmentId}`,
                    eq(notificationLogs.type, "satisfaction_survey"),
                    eq(notificationLogs.status, "sent")
                )
            );
        expect(rows).toHaveLength(1);
    });

    it("is idempotent — second call skips with already_sent", async () => {
        const result = await sendSatisfactionSurveyIfDue(appointmentId, nowAfterDelay);

        expect(result.sent).toBe(false);
        expect(result.skippedReason).toBe("already_sent");

        const rows = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    sql`${notificationLogs.metadata}->>'appointmentId' = ${appointmentId}`,
                    eq(notificationLogs.type, "satisfaction_survey"),
                    eq(notificationLogs.status, "sent")
                )
            );
        expect(rows).toHaveLength(1);
    });

    it("sweeper idempotency — repeated sweeps produce ≤1 sent row", async () => {
        await sweepDueSatisfactionSurveys(nowAfterDelay);
        await sweepDueSatisfactionSurveys(nowAfterDelay);

        const rows = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    sql`${notificationLogs.metadata}->>'appointmentId' = ${appointmentId}`,
                    eq(notificationLogs.type, "satisfaction_survey"),
                    eq(notificationLogs.status, "sent")
                )
            );
        expect(rows).toHaveLength(1);
    });
});
