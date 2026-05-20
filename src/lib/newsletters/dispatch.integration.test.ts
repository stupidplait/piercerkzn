/**
 * Integration tests for newsletter dispatch orchestration.
 *
 * Scope:
 *   11.2 — fanout idempotency: processRecipientJob produces exactly one
 *          notification_log row per recipient; re-invocation is a no-op.
 *   11.3 — stuck recovery: sweepDueCampaigns re-enqueues only unlogged
 *          recipients and bumps startedAt.
 *   11.4 — empty audience: runCampaign with no opted-in customers
 *          transitions directly to `sent` with all counters zero.
 *
 * Requirements: 4.4, 5.1, 5.2, 5.3, 6.3, 6.4
 * Validates Property: 5, 7, 9
 */
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { customers, db, newsletterCampaigns, notificationLogs, settings } from "@/db";
import {
    createCampaign,
    processRecipientJob,
    runCampaign,
    sweepDueCampaigns,
} from "@/lib/newsletters/dispatch";
import { invalidateSettingsCache } from "@/lib/settings";
import { makeTestTag } from "@/test/integration/helpers";

// Mock the audience module so we control which customers are returned
const mockAudience = vi.fn<[], Promise<{ id: string; email: string }[]>>(async () => []);
vi.mock("@/lib/newsletters/audience", () => ({
    selectMarketingAudience: (...args: unknown[]) => mockAudience(...(args as [])),
}));

// Mock the queue so jobs don't actually go to Redis
vi.mock("@/lib/queue", async () => {
    const actual = await vi.importActual<typeof import("@/lib/queue")>("@/lib/queue");
    return {
        ...actual,
        enqueueNewsletterCampaignJob: vi.fn(async () => {}),
    };
});

// Mock resend so no real emails are sent
vi.mock("@/lib/resend", () => ({
    sendEmail: vi.fn(async () => "msg_test_123"),
}));

// Mock posthog
vi.mock("@/lib/posthog", () => ({
    capture: vi.fn(),
}));

const tag = makeTestTag("nl-dispatch");
const FROM_KEY = "newsletter.from_address";

const customerIds: string[] = [];
let optedOutCustomerId: string;

beforeAll(async () => {
    // Seed from_address setting
    await db
        .insert(settings)
        .values({
            key: FROM_KEY,
            value: { text: `${tag}@test.local` },
            groupName: "notifications",
        })
        .onConflictDoUpdate({
            target: settings.key,
            set: { value: { text: `${tag}@test.local` } },
        });
    await invalidateSettingsCache();

    // Seed 3 opted-in customers
    for (let i = 0; i < 3; i++) {
        const [c] = await db
            .insert(customers)
            .values({
                email: `${tag}-${i}@test.local`,
                firstName: `${tag}-${i}`,
                notificationMarketing: true,
            })
            .returning({ id: customers.id });
        customerIds.push(c.id);
    }

    // Seed 1 opted-out customer
    const [out] = await db
        .insert(customers)
        .values({
            email: `${tag}-out@test.local`,
            firstName: `${tag}-out`,
            notificationMarketing: false,
        })
        .returning({ id: customers.id });
    optedOutCustomerId = out.id;

    // Configure audience mock to return our test customers
    mockAudience.mockResolvedValue(
        customerIds.map((id, i) => ({ id, email: `${tag}-${i}@test.local` }))
    );
});

afterAll(async () => {
    // Clean notification_log rows before customers (FK constraint)
    const allCids = [...customerIds, optedOutCustomerId].filter(Boolean);
    if (allCids.length > 0) {
        await db.delete(notificationLogs).where(inArray(notificationLogs.customerId, allCids));
    }
    await db.delete(newsletterCampaigns).where(like(newsletterCampaigns.subject, `%${tag}%`));
    await db.delete(customers).where(like(customers.email, `%${tag}%`));
    await db.delete(settings).where(eq(settings.key, FROM_KEY));
});

describe("newsletter fanout idempotency (11.2)", () => {
    let campaignId: string;

    beforeAll(async () => {
        const campaign = await createCampaign({
            subject: `${tag} idempotency`,
            bodyMarkdown: `Test body ${tag}`,
        });
        campaignId = campaign.id;
        // Transition to sending manually; set recipientCount higher than
        // actual sends so maybeFinaliseCampaign doesn't auto-transition to 'sent'
        await db
            .update(newsletterCampaigns)
            .set({
                state: "sending",
                startedAt: new Date(),
                recipientCount: customerIds.length + 100,
            })
            .where(eq(newsletterCampaigns.id, campaignId));
    });

    it("produces exactly one notification_log row per recipient", async () => {
        for (const cid of customerIds) {
            await processRecipientJob({ campaignId, customerId: cid });
        }

        const logs = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    eq(notificationLogs.type, "newsletter_campaign"),
                    sql`${notificationLogs.metadata} ->> 'campaignId' = ${campaignId}`
                )
            );
        expect(logs).toHaveLength(customerIds.length);
    });

    it("re-invocation is a no-op (no duplicate rows, no second send)", async () => {
        // Process the same campaign+recipients again
        for (const cid of customerIds) {
            const result = await processRecipientJob({ campaignId, customerId: cid });
            expect(result.status).toBe("skipped");
            if (result.status === "skipped") {
                expect(result.reason).toBe("already_sent");
            }
        }

        const logs = await db
            .select()
            .from(notificationLogs)
            .where(
                and(
                    eq(notificationLogs.type, "newsletter_campaign"),
                    sql`${notificationLogs.metadata} ->> 'campaignId' = ${campaignId}`
                )
            );
        // Still the same count — no duplicates
        expect(logs).toHaveLength(customerIds.length);
    });

    it("skips opted-out customers", async () => {
        const result = await processRecipientJob({ campaignId, customerId: optedOutCustomerId });
        expect(result.status).toBe("skipped");
        if (result.status === "skipped") {
            expect(result.reason).toBe("customer_opted_out");
        }
    });
});

describe("newsletter stuck recovery (11.3)", () => {
    let campaignId: string;

    beforeAll(async () => {
        const campaign = await createCampaign({
            subject: `${tag} stuck`,
            bodyMarkdown: `Stuck body ${tag}`,
        });
        campaignId = campaign.id;

        // Put campaign in sending state with startedAt 31 minutes ago
        const stuckTime = new Date(Date.now() - 31 * 60_000);
        await db
            .update(newsletterCampaigns)
            .set({
                state: "sending",
                startedAt: stuckTime,
                recipientCount: customerIds.length,
            })
            .where(eq(newsletterCampaigns.id, campaignId));

        // Insert notification_log for the first customer only (simulating partial send)
        await db.insert(notificationLogs).values({
            type: "newsletter_campaign",
            channel: "email",
            recipient: `${tag}-0@test.local`,
            status: "sent",
            customerId: customerIds[0],
            metadata: { campaignId, customerId: customerIds[0] },
        });
    });

    it("re-enqueues only unlogged recipients and bumps startedAt", async () => {
        const { enqueueNewsletterCampaignJob } = await import("@/lib/queue");
        const mockEnqueue = vi.mocked(enqueueNewsletterCampaignJob);
        mockEnqueue.mockClear();

        const now = new Date();
        const result = await sweepDueCampaigns(now);

        expect(result.recovered).toBeGreaterThanOrEqual(1);
        // Should re-enqueue customerIds[1] and customerIds[2] (not customerIds[0])
        expect(result.recoveredJobs).toBe(2);

        // Verify startedAt was bumped
        const [row] = await db
            .select({ startedAt: newsletterCampaigns.startedAt })
            .from(newsletterCampaigns)
            .where(eq(newsletterCampaigns.id, campaignId));
        expect(row.startedAt!.getTime()).toBeCloseTo(now.getTime(), -3);
    });
});

describe("newsletter empty audience (11.4)", () => {
    it("transitions directly to sent with all counters zero", async () => {
        // Mock audience to return empty array for this test
        mockAudience.mockResolvedValueOnce([]);

        const campaign = await createCampaign({
            subject: `${tag} empty`,
            bodyMarkdown: `Empty body ${tag}`,
        });

        await runCampaign(campaign.id, { allowedFromStates: ["draft"] });

        const [row] = await db
            .select()
            .from(newsletterCampaigns)
            .where(eq(newsletterCampaigns.id, campaign.id));

        expect(row.state).toBe("sent");
        expect(row.recipientCount).toBe(0);
        expect(row.sentCount).toBe(0);
        expect(row.failedCount).toBe(0);
        expect(row.completedAt).not.toBeNull();
    });
});
