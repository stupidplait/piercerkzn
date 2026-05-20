/**
 * Integration tests for the newsletter cron sweep route.
 *
 * Scope:
 *   11.5 — cron sweep promote: a campaign with state='scheduled' and
 *          scheduledAt in the past is promoted to 'sending' and jobs enqueued.
 *   11.7 — cron auth: requests without valid Authorization header get 401.
 *
 * Requirements: 6.2, 6.5
 * Validates Property: 8
 */
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { GET } from "@/app/api/cron/newsletter-sweep/route";
import { db, newsletterCampaigns, settings } from "@/db";
import { createCampaign } from "@/lib/newsletters/dispatch";
import { invalidateSettingsCache } from "@/lib/settings";
import { makeTestTag, readResponse } from "@/test/integration/helpers";

// Mock the queue so jobs don't actually go to Redis
vi.mock("@/lib/queue", async () => {
    const actual = await vi.importActual<typeof import("@/lib/queue")>("@/lib/queue");
    return {
        ...actual,
        enqueueNewsletterCampaignJob: vi.fn(async () => {}),
    };
});

vi.mock("@/lib/resend", () => ({
    sendEmail: vi.fn(async () => "msg_test_123"),
}));

vi.mock("@/lib/posthog", () => ({
    capture: vi.fn(),
}));

const tag = makeTestTag("nl-cron");
const CRON_SECRET_VALUE = "test-cron-secret-newsletter";
const FROM_KEY = "newsletter.from_address";
let priorCronSecret: string | undefined;

beforeAll(async () => {
    priorCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = CRON_SECRET_VALUE;

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
});

afterAll(async () => {
    await db.delete(newsletterCampaigns).where(like(newsletterCampaigns.subject, `%${tag}%`));
    await db.delete(settings).where(eq(settings.key, FROM_KEY));

    if (priorCronSecret === undefined) {
        delete process.env.CRON_SECRET;
    } else {
        process.env.CRON_SECRET = priorCronSecret;
    }
});

function buildCronRequest(authorization?: string): Request {
    const headers: HeadersInit = authorization ? { authorization } : {};
    return new Request("http://test.local/api/cron/newsletter-sweep", {
        method: "GET",
        headers,
    });
}

describe("cron newsletter-sweep promote (11.5)", () => {
    it("promotes a due scheduled campaign to sending", async () => {
        // Create and manually schedule a campaign with scheduledAt in the past
        const campaign = await createCampaign({
            subject: `${tag} promote`,
            bodyMarkdown: `Promote body ${tag}`,
        });
        await db
            .update(newsletterCampaigns)
            .set({
                state: "scheduled",
                scheduledAt: new Date(Date.now() - 60_000), // 1 minute ago
            })
            .where(eq(newsletterCampaigns.id, campaign.id));

        const res = await GET(buildCronRequest(`Bearer ${CRON_SECRET_VALUE}`));
        const { status, json } = await readResponse<{ promoted: number }>(res);

        expect(status).toBe(200);
        expect(json.promoted).toBeGreaterThanOrEqual(1);

        // Verify the campaign is now in 'sending' state
        const [row] = await db
            .select({ state: newsletterCampaigns.state })
            .from(newsletterCampaigns)
            .where(eq(newsletterCampaigns.id, campaign.id));
        // Could be 'sending' or 'sent' (if audience was empty)
        expect(["sending", "sent"]).toContain(row.state);
    });
});

describe("cron newsletter-sweep auth (11.7)", () => {
    it("returns 401 without Authorization header", async () => {
        const res = await GET(buildCronRequest());
        expect(res.status).toBe(401);
    });

    it("returns 401 with malformed bearer", async () => {
        const res = await GET(buildCronRequest("Bearer wrong-secret"));
        expect(res.status).toBe(401);
    });
});
