/**
 * Validation contract tests for the settings PATCH surface.
 */
import { describe, expect, it } from "vitest";

import {
    settingPatchSchema,
    settingValueSchema,
    settingsBulkUpdateSchema,
    settingsCrossGroupPatchSchema,
} from "./admin";

describe("settingValueSchema", () => {
    it.each([
        ["text wrapper", { text: "Студия закрыта в субботу" }],
        ["number wrapper", { number: 72 }],
        ["bool wrapper", { bool: true }],
        ["free-form jsonb", { provider: "smsru", apiKey: "redacted" }],
    ])("accepts %s", (_label, payload) => {
        expect(settingValueSchema.safeParse(payload).success).toBe(true);
    });

    it("treats mixed-shape objects as free-form jsonb", () => {
        // { text, number } isn't a valid strict typed wrapper (extra key),
        // and isn't a single-reserved-key object either, so it falls through
        // to the catch-all branch. This is intentional — integration configs
        // commonly mix string + number fields.
        const r = settingValueSchema.safeParse({ text: "x", number: 5 });
        expect(r.success).toBe(true);
    });

    it("rejects a single-reserved-key object that fails the typed wrapper", () => {
        // { text: <2001 chars> } must NOT be silently accepted by the
        // free-form branch — the typed wrapper's cap is the source of truth
        // for single-key shapes. See settingValueSchema's refine() guard.
        const r = settingValueSchema.safeParse({ text: "a".repeat(2_001) });
        expect(r.success).toBe(false);
    });

    it("rejects non-object values", () => {
        expect(settingValueSchema.safeParse("hello").success).toBe(false);
        expect(settingValueSchema.safeParse(42).success).toBe(false);
        expect(settingValueSchema.safeParse(null).success).toBe(false);
    });

    it("caps text length at 2 000 chars on the typed wrapper", () => {
        expect(settingValueSchema.safeParse({ text: "a".repeat(2_000) }).success).toBe(true);
        expect(settingValueSchema.safeParse({ text: "a".repeat(2_001) }).success).toBe(false);
    });
});

describe("settingPatchSchema", () => {
    it("accepts a single typed value", () => {
        const r = settingPatchSchema.safeParse({ value: { number: 100 } });
        expect(r.success).toBe(true);
    });

    it("rejects empty body", () => {
        expect(settingPatchSchema.safeParse({}).success).toBe(false);
    });

    it("rejects raw value (must be wrapped)", () => {
        expect(settingPatchSchema.safeParse({ value: "raw" }).success).toBe(false);
    });
});

describe("settingsBulkUpdateSchema (existing per-group)", () => {
    it("requires at least one entry", () => {
        const r = settingsBulkUpdateSchema.safeParse({ settings: {} });
        expect(r.success).toBe(false);
    });

    it("accepts a non-empty map", () => {
        const r = settingsBulkUpdateSchema.safeParse({
            settings: {
                "studio.address": { text: "Казань, ул. Баумана 1" },
                "reservation.hold_hours": { number: 72 },
            },
        });
        expect(r.success).toBe(true);
    });
});

describe("settingsCrossGroupPatchSchema", () => {
    it("accepts a non-empty map (same shape as per-group bulk)", () => {
        const r = settingsCrossGroupPatchSchema.safeParse({
            settings: {
                "studio.address": { text: "Казань" },
                "booking.advance_days": { number: 30 },
                "notifications.email_enabled": { bool: true },
            },
        });
        expect(r.success).toBe(true);
    });

    it("rejects empty map", () => {
        expect(settingsCrossGroupPatchSchema.safeParse({ settings: {} }).success).toBe(false);
    });

    it("caps the map at 100 entries", () => {
        const big: Record<string, { number: number }> = {};
        for (let i = 0; i < 101; i++) big[`group.key_${i}`] = { number: i };
        expect(settingsCrossGroupPatchSchema.safeParse({ settings: big }).success).toBe(false);
    });

    it("rejects keys longer than 120 chars", () => {
        const r = settingsCrossGroupPatchSchema.safeParse({
            settings: { [`g.${"x".repeat(120)}`]: { bool: true } },
        });
        expect(r.success).toBe(false);
    });
});
