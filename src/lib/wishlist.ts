/**
 * Wishlist helpers — share-token derivation.
 *
 * Sharing strategy: we don't add a `share_token` column. The token is a
 * deterministic HMAC over the customer id, signed with `AUTH_SECRET`. This
 * means:
 *
 *   - The token is stable per customer.
 *   - Anyone with the URL can view the wishlist (read-only) — accept this
 *     trade-off, identical to "share via link" everywhere else.
 *   - Revoking sharing means rotating `AUTH_SECRET`, which is acceptable
 *     because the studio is single-tenant and rarely needs that.
 *
 * Token format: `${base64url(customerId)}.${hmacHex}` so we know which
 * customer to look up without an enumeration.
 */
import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

function getSecret(): string {
    return (
        process.env.AUTH_SECRET ??
        process.env.NEXTAUTH_SECRET ??
        "dev-secret-please-set-AUTH_SECRET"
    );
}

function b64url(input: string): string {
    return Buffer.from(input, "utf8").toString("base64url");
}

function fromB64url(input: string): string | null {
    try {
        return Buffer.from(input, "base64url").toString("utf8");
    } catch {
        return null;
    }
}

function sign(customerId: string): string {
    return createHmac("sha256", getSecret()).update(customerId).digest("hex");
}

export function buildWishlistShareToken(customerId: string): string {
    return `${b64url(customerId)}.${sign(customerId)}`;
}

/**
 * Verify a share token and return the customer id it encodes, or null if
 * the token is malformed / not signed by us.
 */
export function verifyWishlistShareToken(token: string): string | null {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [encoded, providedHex] = parts;
    const customerId = fromB64url(encoded);
    if (!customerId) return null;
    const expectedHex = sign(customerId);
    let provided: Buffer;
    let expected: Buffer;
    try {
        provided = Buffer.from(providedHex, "hex");
        expected = Buffer.from(expectedHex, "hex");
    } catch {
        return null;
    }
    if (provided.length !== expected.length) return null;
    if (!timingSafeEqual(provided, expected)) return null;
    return customerId;
}
