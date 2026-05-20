/**
 * Time-based one-time-password helpers for admin 2FA.
 *
 * Thin wrapper around `otplib` v13's functional API. Uses RFC 6238 TOTP
 * with the default 6-digit / 30-second profile and a 1-step tolerance
 * (±30s) to soak up small clock drift.
 *
 * v13 requires explicit plugin injection for crypto + base32; we wire in
 * the bundled Noble + Scure plugins so callers don't have to think about it.
 *
 * Storage:
 *   - The base32 secret lives on `admin_user.totp_secret` (encrypted at
 *     rest via Postgres TDE in production).
 *   - `admin_user.totp_enabled` is the source of truth for "is TOTP active";
 *     a non-null `totp_secret` with `totp_enabled = false` means the admin
 *     has started enrollment but hasn't confirmed the code yet.
 */
import "server-only";

import {
    NobleCryptoPlugin,
    ScureBase32Plugin,
    generateSecret as otpGenerateSecret,
    generateURI as otpGenerateURI,
    verifySync as otpVerifySync,
} from "otplib";

const crypto = new NobleCryptoPlugin();
const base32 = new ScureBase32Plugin();

const ISSUER = "PiercerKZN";
const SECRET_BYTES = 20; // 160-bit secret — RFC 4226 recommended.
const WINDOW = 1; // ±1 step tolerance (±30s with 30s period).

export function generateTotpSecret(): string {
    return otpGenerateSecret({ crypto, base32, length: SECRET_BYTES });
}

/**
 * Build the otpauth URI that authenticator apps (Google Authenticator,
 * Authy, 1Password) consume to register the secret. The `account` shows up
 * inside the app to identify which account this code is for.
 */
export function totpKeyUri(account: string, secret: string): string {
    return otpGenerateURI({
        strategy: "totp",
        secret,
        issuer: ISSUER,
        label: account,
    });
}

export function verifyTotpCode(code: string, secret: string): boolean {
    if (!code || !secret) return false;
    try {
        const result = otpVerifySync({
            strategy: "totp",
            secret,
            token: code,
            crypto,
            base32,
            counterTolerance: WINDOW,
        });
        return result.valid === true;
    } catch {
        return false;
    }
}
