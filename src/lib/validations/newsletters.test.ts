/**
 * Validation contract tests for the newsletter campaign admin schemas.
 *
 * Validates: Requirements 2.1, 2.4, 2.5, 2.10
 */
import { describe, expect, it } from "vitest";

import {
    createCampaignSchema,
    previewQuerySchema,
    scheduleCampaignSchema,
    testSendSchema,
    updateCampaignSchema,
} from "./newsletters";

// ---------------------------------------------------------------------------
// createCampaignSchema
// ---------------------------------------------------------------------------
describe("createCampaignSchema — Requirement 2.1", () => {
    const valid = {
        subject: "Майская акция",
        preheader: "Скидка 15% на украшения",
        bodyMarkdown: "# Заголовок\n\nТекст рассылки.",
    };

    it("accepts a canonical valid payload", () => {
        expect(createCampaignSchema.safeParse(valid).success).toBe(true);
    });

    it("accepts the payload without a preheader", () => {
        const r = createCampaignSchema.safeParse({
            subject: valid.subject,
            bodyMarkdown: valid.bodyMarkdown,
        });
        expect(r.success).toBe(true);
    });

    it("rejects missing subject", () => {
        const r = createCampaignSchema.safeParse({
            bodyMarkdown: valid.bodyMarkdown,
        });
        expect(r.success).toBe(false);
    });

    it("rejects empty subject", () => {
        const r = createCampaignSchema.safeParse({
            subject: "",
            bodyMarkdown: valid.bodyMarkdown,
        });
        expect(r.success).toBe(false);
    });

    it("rejects whitespace-only subject (after trim)", () => {
        const r = createCampaignSchema.safeParse({
            subject: "   ",
            bodyMarkdown: valid.bodyMarkdown,
        });
        expect(r.success).toBe(false);
    });

    it("accepts subject of exactly 200 chars", () => {
        const r = createCampaignSchema.safeParse({
            subject: "a".repeat(200),
            bodyMarkdown: valid.bodyMarkdown,
        });
        expect(r.success).toBe(true);
    });

    it("rejects subject > 200 chars", () => {
        const r = createCampaignSchema.safeParse({
            subject: "a".repeat(201),
            bodyMarkdown: valid.bodyMarkdown,
        });
        expect(r.success).toBe(false);
    });

    it("rejects preheader > 200 chars", () => {
        const r = createCampaignSchema.safeParse({
            subject: "ok",
            preheader: "a".repeat(201),
            bodyMarkdown: valid.bodyMarkdown,
        });
        expect(r.success).toBe(false);
    });

    it("rejects empty bodyMarkdown", () => {
        const r = createCampaignSchema.safeParse({
            subject: valid.subject,
            bodyMarkdown: "",
        });
        expect(r.success).toBe(false);
    });

    it("accepts bodyMarkdown of exactly 100 KB", () => {
        const body = "a".repeat(100 * 1024);
        const r = createCampaignSchema.safeParse({
            subject: valid.subject,
            bodyMarkdown: body,
        });
        expect(r.success).toBe(true);
    });

    it("rejects bodyMarkdown > 100 KB", () => {
        const body = "a".repeat(100 * 1024 + 1);
        const r = createCampaignSchema.safeParse({
            subject: valid.subject,
            bodyMarkdown: body,
        });
        expect(r.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// updateCampaignSchema
// ---------------------------------------------------------------------------
describe("updateCampaignSchema — Requirement 2.4", () => {
    it("accepts an empty patch", () => {
        expect(updateCampaignSchema.safeParse({}).success).toBe(true);
    });

    it("accepts a single-field patch", () => {
        const r = updateCampaignSchema.safeParse({ subject: "new" });
        expect(r.success).toBe(true);
    });

    it("accepts a null preheader (clear it)", () => {
        const r = updateCampaignSchema.safeParse({ preheader: null });
        expect(r.success).toBe(true);
    });

    it("rejects subject > 200 chars", () => {
        const r = updateCampaignSchema.safeParse({
            subject: "a".repeat(201),
        });
        expect(r.success).toBe(false);
    });

    it("rejects empty bodyMarkdown when provided", () => {
        const r = updateCampaignSchema.safeParse({ bodyMarkdown: "" });
        expect(r.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// scheduleCampaignSchema
// ---------------------------------------------------------------------------
describe("scheduleCampaignSchema — Requirement 2.5", () => {
    const futureIso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

    it("accepts an ISO datetime ≥ now + 1 minute (UTC `Z` form)", () => {
        const r = scheduleCampaignSchema.safeParse({
            scheduledAt: futureIso(120_000), // +2m
        });
        expect(r.success).toBe(true);
    });

    it("accepts an ISO datetime with a timezone offset", () => {
        // +03:00 (Moscow). Build with the Moscow wall clock = UTC+3, then
        // suffix `+03:00` so the parsed instant resolves to "now + a few
        // minutes" in UTC.
        const future = new Date(Date.now() + 5 * 60_000 + 3 * 60 * 60_000);
        const isoLocal = future.toISOString().replace("Z", "+03:00");
        const r = scheduleCampaignSchema.safeParse({ scheduledAt: isoLocal });
        expect(r.success).toBe(true);
    });

    it("rejects scheduledAt in the past", () => {
        const r = scheduleCampaignSchema.safeParse({
            scheduledAt: futureIso(-3_600_000), // -1h
        });
        expect(r.success).toBe(false);
    });

    it("rejects scheduledAt < now + 1 minute", () => {
        const r = scheduleCampaignSchema.safeParse({
            scheduledAt: futureIso(30_000), // +30s — under the 1m floor
        });
        expect(r.success).toBe(false);
    });

    it("rejects a non-ISO string", () => {
        const r = scheduleCampaignSchema.safeParse({
            scheduledAt: "tomorrow at 5",
        });
        expect(r.success).toBe(false);
    });

    it("rejects a missing scheduledAt", () => {
        const r = scheduleCampaignSchema.safeParse({});
        expect(r.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// testSendSchema
// ---------------------------------------------------------------------------
describe("testSendSchema — Requirement 2.10", () => {
    it("accepts a valid email", () => {
        expect(testSendSchema.safeParse({ to: "admin@piercerkzn.ru" }).success).toBe(true);
    });

    it.each(["not-an-email", "missing@tld", "@only-domain.com", "spaces in@example.com", ""])(
        "rejects malformed email: %s",
        (to) => {
            expect(testSendSchema.safeParse({ to }).success).toBe(false);
        }
    );

    it("rejects a missing `to`", () => {
        expect(testSendSchema.safeParse({}).success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// previewQuerySchema
// ---------------------------------------------------------------------------
describe("previewQuerySchema", () => {
    it("accepts an empty object (preview is GET-/POST-without-body)", () => {
        expect(previewQuerySchema.safeParse({}).success).toBe(true);
    });

    it("passes unknown keys through (passthrough())", () => {
        const r = previewQuerySchema.safeParse({ unknown: 1 });
        expect(r.success).toBe(true);
    });
});
