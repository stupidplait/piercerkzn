/**
 * Unit tests for the auth → customer sync helpers.
 *
 * `ensureCustomerForAuthUser` itself talks to the DB and is exercised by the
 * Phase B integration suite (real Postgres branch). Here we cover the pure
 * `splitDisplayName` helper, which is responsible for the user-visible
 * profile name derivation on first sign-in.
 */
import { describe, expect, it } from "vitest";

import { mapOauthProvider, splitDisplayName } from "./auth-customer-sync.utils";

describe("splitDisplayName", () => {
    it("splits a two-part display name", () => {
        expect(splitDisplayName("Алина Иванова", "alina@example.com")).toEqual({
            firstName: "Алина",
            lastName: "Иванова",
        });
    });

    it("captures all trailing parts as lastName", () => {
        expect(splitDisplayName("Иван Иванович Иванов", "i@example.com")).toEqual({
            firstName: "Иван",
            lastName: "Иванович Иванов",
        });
    });

    it("treats a single token as firstName only", () => {
        expect(splitDisplayName("Алина", "x@example.com")).toEqual({
            firstName: "Алина",
            lastName: null,
        });
    });

    it("falls back to the email local-part when name is missing", () => {
        expect(splitDisplayName(null, "alina.smirnova@example.com")).toEqual({
            firstName: "Alina smirnova",
            lastName: null,
        });
    });

    it("normalises blank name to fallback", () => {
        expect(splitDisplayName("   ", "test_user@example.com")).toEqual({
            firstName: "Test user",
            lastName: null,
        });
    });

    it("produces a non-empty firstName even for empty local-part", () => {
        // Pathological — the schema enforces a real email, but the helper
        // still must return a non-empty firstName because `customer.first_name`
        // is NOT NULL.
        const r = splitDisplayName("", "@example.com");
        expect(r.firstName.length).toBeGreaterThan(0);
        expect(r.lastName).toBeNull();
    });

    it("truncates extremely long parts to the column length", () => {
        const long = "А".repeat(200);
        const r = splitDisplayName(`${long} ${long}`, "x@example.com");
        expect(r.firstName.length).toBe(100);
        expect(r.lastName?.length).toBe(100);
    });
});

describe("mapOauthProvider", () => {
    it("preserves known social providers", () => {
        expect(mapOauthProvider("vk")).toBe("vk");
        expect(mapOauthProvider("VK")).toBe("vk");
        expect(mapOauthProvider("telegram")).toBe("telegram");
    });

    it("drops magic-link / credentials providers (not OAuth tags)", () => {
        expect(mapOauthProvider("resend")).toBeNull();
        expect(mapOauthProvider("email")).toBeNull();
        expect(mapOauthProvider("credentials")).toBeNull();
    });

    it("returns null for empty input", () => {
        expect(mapOauthProvider(null)).toBeNull();
        expect(mapOauthProvider(undefined)).toBeNull();
        expect(mapOauthProvider("")).toBeNull();
    });

    it("preserves unknown providers as-is for diagnostics", () => {
        expect(mapOauthProvider("apple")).toBe("apple");
    });
});
