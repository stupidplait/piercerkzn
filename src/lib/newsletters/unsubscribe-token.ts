/**
 * Newsletter unsubscribe-token helpers.
 *
 * Mirrors the HMAC shape of `lib/wishlist.ts` (same base64url envelope, same
 * `AUTH_SECRET` HMAC key, same `timingSafeEqual` verification) with a
 * `:marketing` namespace suffix so a wishlist token cannot be replayed
 * against the unsubscribe endpoint and vice-versa.
 *
 * Token format: `${base64url(customerId)}.${hmacHex(customerId + ":marketing")}`.
 */
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const NAMESPACE = ":marketing";

function getSecret(): string {
    const s = process.env.AUTH_SECRET;
    if (!s) {
        throw new Error("AUTH_SECRET is required for unsubscribe tokens");
    }
    return s;
}

function b64url(input: string): string {
    return Buffer.from(input, "utf8")
        .toString("base64")
        .replace(/=+$/u, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

function b64urlDecode(input: string): string | null {
    try {
        const padded = input.replace(/-/g, "+").replace(/_/g, "/");
        const pad = padded.length % 4;
        const fixed = pad ? padded + "=".repeat(4 - pad) : padded;
        return Buffer.from(fixed, "base64").toString("utf8");
    } catch {
        return null;
    }
}

function sign(customerId: string): string {
    return createHmac("sha256", getSecret()).update(`${customerId}${NAMESPACE}`).digest("hex");
}

export function buildUnsubscribeToken(customerId: string): string {
    return `${b64url(customerId)}.${sign(customerId)}`;
}

export function verifyUnsubscribeToken(token: string): string | null {
    if (!token || typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encoded, providedSig] = parts;
    const customerId = b64urlDecode(encoded);
    if (!customerId) return null;
    const expectedSig = sign(customerId);
    if (providedSig.length !== expectedSig.length) return null;
    try {
        const a = Buffer.from(providedSig, "hex");
        const b = Buffer.from(expectedSig, "hex");
        if (a.length !== b.length) return null;
        return timingSafeEqual(a, b) ? customerId : null;
    } catch {
        return null;
    }
}
