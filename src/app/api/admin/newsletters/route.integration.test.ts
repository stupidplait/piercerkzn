/**
 * Integration tests for the newsletter admin author-schedule lifecycle.
 *
 * Scope (task 11.1):
 *   1. POST /api/admin/newsletters creates a draft campaign.
 *   2. PATCH /api/admin/newsletters/:id updates subject/body while in draft.
 *   3. POST /api/admin/newsletters/:id/schedule transitions draft → scheduled.
 *   4. PATCH against an already-scheduled campaign returns 409 unchanged.
 *
 * Requirements: 2.1, 2.4, 2.5, 3.7
 * Validates Property: 3
 */
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as createRoute, GET as listRoute } from "@/app/api/admin/newsletters/route";
import { PATCH } from "@/app/api/admin/newsletters/[id]/route";
import { POST as scheduleRoute } from "@/app/api/admin/newsletters/[id]/schedule/route";
import { adminUsers, db, newsletterCampaigns, settings } from "@/db";
import { invalidateSettingsCache } from "@/lib/settings";
import { buildRequest, makeTestTag, readResponse } from "@/test/integration/helpers";

const tag = makeTestTag("nl-author");
let campaignId: string;

const ADMIN_ID = "00000000-0000-0000-0000-0000000000aa";
const FROM_KEY = `newsletter.from_address`;

beforeAll(async () => {
    // Ensure the mock admin user exists (FK target for created_by_user_id)
    await db
        .insert(adminUsers)
        .values({
            id: ADMIN_ID,
            email: `${tag}-admin@test.local`,
            passwordHash: "not-a-real-hash",
            firstName: "Test",
            role: "owner",
        })
        .onConflictDoNothing();

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
    await db.delete(adminUsers).where(eq(adminUsers.id, ADMIN_ID));
});

describe("newsletter author-schedule lifecycle", () => {
    it("POST creates a draft campaign (Req 2.1)", async () => {
        const res = await createRoute(
            buildRequest("/api/admin/newsletters", "POST", {
                body: {
                    subject: `${tag} subject`,
                    bodyMarkdown: `Hello **${tag}**`,
                },
            })
        );
        const { status, json } = await readResponse<{ campaign: { id: string; state: string } }>(
            res
        );
        expect(status).toBe(201);
        expect(json.campaign.state).toBe("draft");
        campaignId = json.campaign.id;
    });

    it("PATCH updates a draft campaign (Req 2.4)", async () => {
        const res = await PATCH(
            buildRequest(`/api/admin/newsletters/${campaignId}`, "PATCH", {
                body: { subject: `${tag} updated` },
            }),
            { params: Promise.resolve({ id: campaignId }) }
        );
        const { status, json } = await readResponse<{ campaign: { subject: string } }>(res);
        expect(status).toBe(200);
        expect(json.campaign.subject).toBe(`${tag} updated`);
    });

    it("POST schedule transitions draft → scheduled (Req 2.5)", async () => {
        const future = new Date(Date.now() + 3_600_000).toISOString();
        const res = await scheduleRoute(
            buildRequest(`/api/admin/newsletters/${campaignId}/schedule`, "POST", {
                body: { scheduledAt: future },
            }),
            { params: Promise.resolve({ id: campaignId }) }
        );
        const { status, json } = await readResponse<{ campaign: { state: string } }>(res);
        expect(status).toBe(200);
        expect(json.campaign.state).toBe("scheduled");
    });

    it("PATCH against a scheduled campaign returns 409 (Req 3.7)", async () => {
        const res = await PATCH(
            buildRequest(`/api/admin/newsletters/${campaignId}`, "PATCH", {
                body: { subject: `${tag} should-fail` },
            }),
            { params: Promise.resolve({ id: campaignId }) }
        );
        const { status, json } = await readResponse<{ error: { code: string } }>(res);
        expect(status).toBe(409);
        expect(json.error.code).toBe("invalid_transition");

        // Verify row is unchanged
        const [row] = await db
            .select({ subject: newsletterCampaigns.subject })
            .from(newsletterCampaigns)
            .where(eq(newsletterCampaigns.id, campaignId));
        expect(row.subject).toBe(`${tag} updated`);
    });
});
