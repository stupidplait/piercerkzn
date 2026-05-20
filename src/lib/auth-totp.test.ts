/**
 * Unit tests for the TOTP wrapper.
 *
 * Pure logic — verifies that we round-trip a generated secret through
 * the authenticator's own code generator.
 */
import { NobleCryptoPlugin, ScureBase32Plugin, generateSync as otpGenerateSync } from "otplib";
import { describe, expect, it } from "vitest";

import { generateTotpSecret, totpKeyUri, verifyTotpCode } from "./auth-totp";

const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();

function freshCode(secret: string): string {
    return otpGenerateSync({ secret, strategy: "totp", crypto, base32 });
}

describe("totp helper", () => {
    it("generates a base32 secret", () => {
        const secret = generateTotpSecret();
        expect(secret).toMatch(/^[A-Z2-7]+=*$/);
        expect(secret.length).toBeGreaterThanOrEqual(16);
    });

    it("verifies a freshly generated code", () => {
        const secret = generateTotpSecret();
        const code = freshCode(secret);
        expect(verifyTotpCode(code, secret)).toBe(true);
    });

    it("rejects a wrong code", () => {
        const secret = generateTotpSecret();
        const wrong = "000000";
        // Vanishingly small chance the rolling code coincides; pick a deterministic dud.
        expect(verifyTotpCode(wrong, secret)).toBe(false);
    });

    it("rejects empty input without throwing", () => {
        const secret = generateTotpSecret();
        expect(verifyTotpCode("", secret)).toBe(false);
        expect(verifyTotpCode("123456", "")).toBe(false);
    });

    it("builds an otpauth URI containing issuer + account", () => {
        const secret = generateTotpSecret();
        const uri = totpKeyUri("owner@piercerkzn.ru", secret);
        expect(uri).toMatch(/^otpauth:\/\/totp\//);
        expect(uri).toContain("PiercerKZN");
        expect(uri).toContain(encodeURIComponent("owner@piercerkzn.ru"));
        expect(uri).toContain(`secret=${secret}`);
    });
});
