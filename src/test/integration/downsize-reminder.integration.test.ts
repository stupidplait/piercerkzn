/**
 * Integration test — downsize reminder pipeline.
 *
 * Properties covered:
 *   - Property 17: Downsize atomic flag-flip and log
 *   - Property 20: Downsize sweeper idempotency
 *   - Integration wiring: enqueue gating, send + flag flip, idempotency,
 *     opted-out customer handling
 *
 * Validates: Tasks 4.6, 4.9, 4.16
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";

import { db, aftercareTracking, customers, notificationLogs } from "@/db";
import { makeTestTag } from "@/test/integration/helpers";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const sendEmailMock = vi.hoisted(() => vi.fn(async () => ({ id: "msg_ds_test" })));
const enqueueDownsizeReminderQueueMock = vi.hoisted(() => vi.fn(async () => undefined));
const redisDelMock = vi.hoisted(() => vi.fn(async () => 1));
const redisZremMock = vi.hoisted(() => vi.fn(async () => 1));
const getAftercareSettingsMock = vi.hoisted(() =>
    vi.fn(async () => ({
        maxDays: 90,
        downsizePiercingTypes: ["ear", "lip", "nose", "navel", "eyebrow"],
    }))
);

vi.mock("@/lib/resend", () => ({ sendEmail: sendEmailMock }));
vi.mock("@/lib/posthog", () => ({ capture: vi.fn() }));
vi.mock("@/lib/redis", () => ({ redis: { del: redisDelMock, zrem: redisZremMock } }));
vi.mock("@/lib/settings", () => ({ getAftercareSettings: getAftercareSettingsMock }));
vi.mock("@/lib/queue", async () => {
    const actual = await vi.importActual<typeof import("@/lib/queue")>("@/lib/queue");
    return { ...actual, enqueueDownsizeReminder: enqueueDownsizeReminderQueueMock };
});

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------
import {
    enqueueDownsizeReminder,
    sendDownsizeReminderIfDue,
    sweepDueDownsizeReminders,
} from "@/lib/downsize/reminders";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const tag = makeTestTag("ds-rem");
const PIERCING_DATE = "2026-05-14";
// piercingDate + 42d = 2026-06-25, fire at 06:00 UTC. Use 2026-06-26 to be past.
const NOW_AFTER_42D = new Date("2026-06-26T07:00:00Z");

let customer1Id: string;
let customer2Id: string; // opted out
let tracking1Id: string; // ear — eligible
let tracking2Id: string; // industrial — not eligible
let tracking3Id: string; // ear, opted-out customer

beforeAll(async () => {
    const [c1] = await db
        .insert(customers)
        .values({ email: `${tag}-1@test.local`, firstName: tag, notificationEmail: true })
        .returning({ id: customers.id });
    customer1Id = c1.id;

    const [c2] = await db
        .insert(customers)
        .values({ email: `${tag}-2@test.local`, firstName: tag, notificationEmail: false })
        .returning({ id: customers.id });
    customer2Id = c2.id;

    const [t1] = await db
        .insert(aftercareTracking)
        .values({
            customerId: customer1Id,
            piercingType: "ear",
            piercingDate: PIERCING_DATE,
            isActive: true,
            downsizeReminded: false,
        })
        .returning({ id: aftercareTracking.id });
    tracking1Id = t1.id;

    const [t2] = await db
        .insert(aftercareTracking)
        .values({
            customerId: customer1Id,
            piercingType: "industrial",
            piercingDate: PIERCING_DATE,
            isActive: true,
            downsizeReminded: false,
        })
        .returning({ id: aftercareTracking.id });
    tracking2Id = t2.id;

    const [t3] = await db
        .insert(aftercareTracking)
        .values({
            customerId: customer2Id,
            piercingType: "ear",
            piercingDate: PIERCING_DATE,
            isActive: true,
            downsizeReminded: false,
        })
        .returning({ id: aftercareTracking.id });
    tracking3Id = t3.id;
});

afterAll(async () => {
    await db
        .delete(notificationLogs)
        .where(
            sql`${notificationLogs.metadata} ->> 'trackingId' IN (${tracking1Id}, ${tracking2Id}, ${tracking3Id})`
        );
    await db.delete(aftercareTracking).where(eq(aftercareTracking.id, tracking1Id));
    await db.delete(aftercareTracking).where(eq(aftercareTracking.id, tracking2Id));
    await db.delete(aftercareTracking).where(eq(aftercareTracking.id, tracking3Id));
    await db.delete(customers).where(eq(customers.id, customer1Id));
    await db.delete(customers).where(eq(customers.id, customer2Id));
});

// ===========================================================================
// Enqueue gating
// ===========================================================================
describe("enqueueDownsizeReminder — integration", () => {
    it("schedules eligible type (ear), skips ineligible type (industrial)", async () => {
        const now = new Date("2026-05-14T10:00:00Z"); // before fire time

        const r1 = await enqueueDownsizeReminder(
            {
                id: tracking1Id,
                appointmentId: null,
                customerId: customer1Id,
                piercingDate: PIERCING_DATE,
                piercingType: "ear",
            },
            { maxDays: 90, downsizePiercingTypes: ["ear", "lip", "nose", "navel", "eyebrow"] },
            now
        );
        expect(r1.scheduled).toBe(true);

        const r2 = await enqueueDownsizeReminder(
            {
                id: tracking2Id,
                appointmentId: null,
                customerId: customer1Id,
                piercingDate: PIERCING_DATE,
                piercingType: "industrial",
            },
            { maxDays: 90, downsizePiercingTypes: ["ear", "lip", "nose", "navel", "eyebrow"] },
            now
        );
        expect(r2.scheduled).toBe(false);
        expect(r2.reason).toBe("type_not_eligible");
    });
});

// ===========================================================================
// Property 17 — atomic flag-flip and log
// ===========================================================================
describe("sendDownsizeReminderIfDue — Property 17", () => {
    it("positive: send success flips flag and writes log row", async () => {
        sendEmailMock.mockResolvedValue({ id: "msg_ds_ok" });

        const result = await sendDownsizeReminderIfDue(tracking1Id, NOW_AFTER_42D);
        expect(result.sent).toBe(true);

        // Flag flipped
        const [row] = await db
            .select({ downsizeReminded: aftercareTracking.downsizeReminded })
            .from(aftercareTracking)
            .where(eq(aftercareTracking.id, tracking1Id));
        expect(row.downsizeReminded).toBe(true);

        // Log row exists
        const logs = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    sql`${notificationLogs.metadata} ->> 'trackingId' = ${tracking1Id}`,
                    eq(notificationLogs.type, "downsize_reminder"),
                    eq(notificationLogs.status, "sent")
                )
            );
        expect(logs).toHaveLength(1);
    });

    it("idempotency: second call returns already_sent, no duplicate", async () => {
        const result = await sendDownsizeReminderIfDue(tracking1Id, NOW_AFTER_42D);
        expect(result.sent).toBe(false);
        expect(result.skippedReason).toBe("already_sent");

        const logs = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    sql`${notificationLogs.metadata} ->> 'trackingId' = ${tracking1Id}`,
                    eq(notificationLogs.type, "downsize_reminder"),
                    eq(notificationLogs.status, "sent")
                )
            );
        expect(logs).toHaveLength(1);
    });

    it("negative: dispatch failure leaves neither post-condition", async () => {
        // Reset state
        await db
            .update(aftercareTracking)
            .set({ downsizeReminded: false })
            .where(eq(aftercareTracking.id, tracking1Id));
        await db
            .delete(notificationLogs)
            .where(sql`${notificationLogs.metadata} ->> 'trackingId' = ${tracking1Id}`);

        sendEmailMock.mockResolvedValueOnce(null as unknown as { id: string });

        const result = await sendDownsizeReminderIfDue(tracking1Id, NOW_AFTER_42D);
        expect(result.sent).toBe(false);
        expect(result.skippedReason).toBe("dispatch_failed");

        // Flag NOT flipped
        const [row] = await db
            .select({ downsizeReminded: aftercareTracking.downsizeReminded })
            .from(aftercareTracking)
            .where(eq(aftercareTracking.id, tracking1Id));
        expect(row.downsizeReminded).toBe(false);

        // No sent log row
        const logs = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    sql`${notificationLogs.metadata} ->> 'trackingId' = ${tracking1Id}`,
                    eq(notificationLogs.type, "downsize_reminder"),
                    eq(notificationLogs.status, "sent")
                )
            );
        expect(logs).toHaveLength(0);
    });
});

// ===========================================================================
// Opted-out customer
// ===========================================================================
describe("sendDownsizeReminderIfDue — opted-out customer", () => {
    it("does not flip flag and does not send", async () => {
        const result = await sendDownsizeReminderIfDue(tracking3Id, NOW_AFTER_42D);
        expect(result.sent).toBe(false);
        expect(result.skippedReason).toBe("opted_out");

        const [row] = await db
            .select({ downsizeReminded: aftercareTracking.downsizeReminded })
            .from(aftercareTracking)
            .where(eq(aftercareTracking.id, tracking3Id));
        expect(row.downsizeReminded).toBe(false);
    });
});

// ===========================================================================
// Property 20 — sweeper idempotency
// ===========================================================================
describe("sweepDueDownsizeReminders — Property 20", () => {
    it("repeated sweeps produce ≤1 sent log row per tracking", async () => {
        // Reset tracking1 for a clean sweep test
        await db
            .update(aftercareTracking)
            .set({ downsizeReminded: false })
            .where(eq(aftercareTracking.id, tracking1Id));
        await db
            .delete(notificationLogs)
            .where(sql`${notificationLogs.metadata} ->> 'trackingId' = ${tracking1Id}`);
        sendEmailMock.mockResolvedValue({ id: "msg_ds_sweep" });

        await sweepDueDownsizeReminders(NOW_AFTER_42D);
        await sweepDueDownsizeReminders(NOW_AFTER_42D);

        const logs = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    sql`${notificationLogs.metadata} ->> 'trackingId' = ${tracking1Id}`,
                    eq(notificationLogs.type, "downsize_reminder"),
                    eq(notificationLogs.status, "sent")
                )
            );
        expect(logs.length).toBeLessThanOrEqual(1);
    });
});
