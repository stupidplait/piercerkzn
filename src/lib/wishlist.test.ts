/**
 * Unit tests for the wishlist share-token HMAC scheme.
 *
 * Set AUTH_SECRET before importing the module so the helper picks up a
 * deterministic key. The test setup file (`src/test/setup.ts`) is loaded
 * before this file, so it's safe to mutate process.env here.
 */
import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

process.env.AUTH_SECRET = "test-secret-deterministic";

import { fc, fcAssert } from "@/test/property/fc-config";

import { buildWishlistShareToken, verifyWishlistShareToken } from "./wishlist";

describe("wishlist share token", () => {
    const customerId = "11111111-2222-3333-4444-555555555555";

    it("round-trips a valid token", () => {
        const token = buildWishlistShareToken(customerId);
        expect(verifyWishlistShareToken(token)).toBe(customerId);
    });

    it("returns the same token for the same customer (deterministic)", () => {
        expect(buildWishlistShareToken(customerId)).toBe(buildWishlistShareToken(customerId));
    });

    it("rejects a tampered token", () => {
        const token = buildWishlistShareToken(customerId);
        const [head, sig] = token.split(".");
        const flipped = `${head}.${sig.replace(/^./, sig.startsWith("a") ? "b" : "a")}`;
        expect(verifyWishlistShareToken(flipped)).toBe(null);
    });

    it("rejects a malformed token", () => {
        expect(verifyWishlistShareToken("not-a-token")).toBe(null);
        expect(verifyWishlistShareToken("missing.parts.too.many")).toBe(null);
    });
});

describe("wishlist share token — properties (Phase 3 PBT)", () => {
    // Property 5 covers two sub-properties on the same primitive:
    //   (a) Round-trip — `verifyWishlistShareToken(buildWishlistShareToken(id))
    //       === id` for any UUID-shaped `id`.
    //   (b) Bit-flip rejection — flipping any single bit of the 256-bit
    //       HMAC suffix yields `verifyWishlistShareToken(tampered) === null`.
    //
    // Token format from `lib/wishlist.ts`:
    //   `${base64url(customerId)}.${hmacSha256Hex(customerId)}`
    // The base64url alphabet contains no `.`, so `token.lastIndexOf(".")`
    // splits the head from the 64-hex-char HMAC suffix unambiguously. The
    // HMAC is 32 bytes = 256 bits, so `bitIndex ∈ [0, 255]` selects exactly
    // one bit to flip via `buf[bitIndex >> 3] ^= 1 << (bitIndex & 7)`.
    //
    // PBT runs in the unit suite (no DB, pure HMAC), goes through
    // `fcAssert` (per Req 7.6 + the `local/no-direct-fc-assert` ESLint rule).
    //
    // Feature: testing-strategy-rollout, Property 5: Wishlist share-token round-trip
    it("Property 5: round-trips any UUID customerId and rejects single-bit HMAC mutations (Req 3.6)", () => {
        // (a) Round-trip
        fcAssert(
            fc.property(fc.uuid(), (customerId) => {
                const token = buildWishlistShareToken(customerId);
                expect(verifyWishlistShareToken(token)).toBe(customerId);
            })
        );

        // (b) Bit-flip rejection over the 32-byte HMAC suffix
        fcAssert(
            fc.property(
                fc.uuid(),
                fc.integer({ min: 0, max: 32 * 8 - 1 }),
                (customerId, bitIndex) => {
                    const token = buildWishlistShareToken(customerId);
                    const dotIndex = token.lastIndexOf(".");
                    const head = token.slice(0, dotIndex);
                    const hmacHex = token.slice(dotIndex + 1);
                    const buf = Buffer.from(hmacHex, "hex");
                    // Sanity: SHA-256 → 32 bytes; if format ever drifts, the
                    // property's pre-condition is violated and the test
                    // SHOULD fail loudly rather than silently no-op.
                    expect(buf.length).toBe(32);
                    const byteIdx = bitIndex >> 3;
                    const bit = bitIndex & 7;
                    buf[byteIdx] ^= 1 << bit;
                    const tampered = `${head}.${buf.toString("hex")}`;
                    expect(verifyWishlistShareToken(tampered)).toBe(null);
                }
            )
        );
    });
});
