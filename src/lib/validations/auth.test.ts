/**
 * Validation schema tests — sanity-check the contracts the API and forms
 * will rely on. Avoids regressions when fields are renamed.
 */
import { describe, expect, it } from "vitest";

import {
    changePasswordSchema,
    deleteAccountSchema,
    loginSchema,
    registerSchema,
    telegramLoginSchema,
    updateProfileSchema,
} from "./auth";

describe("loginSchema", () => {
    it("accepts a plausible login payload", () => {
        const r = loginSchema.safeParse({
            email: "ALINA@EXAMPLE.COM",
            password: "secret123",
        });
        expect(r.success).toBe(true);
        if (r.success) {
            // emailSchema lowercases on parse
            expect(r.data.email).toBe("alina@example.com");
        }
    });

    it("rejects empty password", () => {
        const r = loginSchema.safeParse({ email: "a@b.com", password: "" });
        expect(r.success).toBe(false);
    });
});

describe("registerSchema", () => {
    it("accepts a complete payload", () => {
        const r = registerSchema.safeParse({
            email: "alina@example.com",
            password: "longerSecret!1",
            confirmPassword: "longerSecret!1",
            firstName: "Алина",
            phone: "+79991234567",
        });
        expect(r.success).toBe(true);
    });

    it("rejects mismatched passwords", () => {
        const r = registerSchema.safeParse({
            email: "alina@example.com",
            password: "longerSecret!1",
            confirmPassword: "different",
            firstName: "Алина",
        });
        expect(r.success).toBe(false);
    });

    it("rejects too-short passwords", () => {
        const r = registerSchema.safeParse({
            email: "alina@example.com",
            password: "short",
            confirmPassword: "short",
            firstName: "Алина",
        });
        expect(r.success).toBe(false);
    });

    it("rejects malformed Russian phone", () => {
        const r = registerSchema.safeParse({
            email: "alina@example.com",
            password: "longerSecret!1",
            confirmPassword: "longerSecret!1",
            firstName: "Алина",
            phone: "12345",
        });
        expect(r.success).toBe(false);
    });
});

describe("updateProfileSchema", () => {
    it("accepts a partial update", () => {
        const r = updateProfileSchema.safeParse({ firstName: "Алина" });
        expect(r.success).toBe(true);
    });

    it("accepts notification toggles", () => {
        const r = updateProfileSchema.safeParse({
            notificationEmail: false,
            notificationMarketing: true,
        });
        expect(r.success).toBe(true);
    });

    it("accepts null to clear optional fields", () => {
        const r = updateProfileSchema.safeParse({ phone: null, lastName: null });
        expect(r.success).toBe(true);
    });

    it("rejects an empty object", () => {
        const r = updateProfileSchema.safeParse({});
        expect(r.success).toBe(false);
    });

    it("rejects a malformed dateOfBirth", () => {
        const r = updateProfileSchema.safeParse({ dateOfBirth: "12-31-2000" });
        expect(r.success).toBe(false);
    });
});

describe("changePasswordSchema", () => {
    it("accepts matching passwords", () => {
        const r = changePasswordSchema.safeParse({
            currentPassword: "old-secret",
            newPassword: "newSecret!",
            confirmPassword: "newSecret!",
        });
        expect(r.success).toBe(true);
    });

    it("rejects mismatched confirm", () => {
        const r = changePasswordSchema.safeParse({
            currentPassword: "old",
            newPassword: "newSecret!",
            confirmPassword: "different",
        });
        expect(r.success).toBe(false);
    });

    it("rejects short new password", () => {
        const r = changePasswordSchema.safeParse({
            currentPassword: "old",
            newPassword: "short",
            confirmPassword: "short",
        });
        expect(r.success).toBe(false);
    });
});

describe("deleteAccountSchema", () => {
    it("accepts an empty body", () => {
        // OAuth-only customers don't supply a password.
        const r = deleteAccountSchema.safeParse({});
        expect(r.success).toBe(true);
    });

    it("accepts a confirmation password and reason", () => {
        const r = deleteAccountSchema.safeParse({
            password: "secret",
            reason: "Не пользуюсь сервисом",
        });
        expect(r.success).toBe(true);
    });
});

describe("telegramLoginSchema", () => {
    it("accepts a Login Widget payload", () => {
        const r = telegramLoginSchema.safeParse({
            id: "12345",
            first_name: "Алина",
            auth_date: "1745000000",
            hash: "a".repeat(64),
        });
        expect(r.success).toBe(true);
    });

    it("rejects bad hash format", () => {
        const r = telegramLoginSchema.safeParse({
            id: 12345,
            first_name: "Алина",
            auth_date: 1745000000,
            hash: "not-hex",
        });
        expect(r.success).toBe(false);
    });
});
