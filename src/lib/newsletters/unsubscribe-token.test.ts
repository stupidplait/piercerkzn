/**
 * Unit tests for the newsletter unsubscribe-token HMAC scheme.
 *
 * Set AUTH_SECRET before importing the module so the helper picks up a
 * deterministic key — the test setup file is loaded earlier so mutating
 * process.env at import time is safe.
 *
 * Properties covered (per the design doc's Correctness Properties section):
 *   - Property 13: Token round-trip is deterministic and verifiable
 *   - Property 14: Tampered tokens / cross-namespace tokens never validate
 */
import { describe, expect, it } from "vitest";
import fc from "fast-check";

process.env.AUTH_SECRET = "test-secret-deterministic-newsletter";

import { buildUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe-token";
import { buildWishlistShareToken } from "@/lib/wishlist";

// ===========================================================================
// Property 13 — Round-trip
// Validates: Requirements 8.2, 8.4
// ===========================================================================
describe("unsubscribe token — Property 13: round-trip", () => {
    const fixedIds = [
        "11111111-2222-3333-4444-555555555555",
        "00000000-0000-0000-0000-000000000001",
        "abc-customer-id",
        // Cyrillic body — stress the base64url + UTF-8 round-trip.
        "клиент-001",
    ];

    it.each(fixedIds)("round-trips %s", (id) => {
        expect(verifyUnsubscribeToken(buildUnsubscribeToken(id))).toBe(id);
    });

    it("is deterministic — same id produces the same token across calls", () => {
        const id = "11111111-2222-3333-4444-555555555555";
        expect(buildUnsubscribeToken(id)).toBe(buildUnsubscribeToken(id));
    });

    // Property: any non-empty utf-8 string round-trips through build/verify.
    it("round-trips any printable customer id (property)", () => {
        fcAssert(
            fc.property(
                fc
                    .string({ minLength: 1, maxLength: 64 })
                    .filter((s) => s.length > 0 && !s.includes("\u0000")),
                (id) => {
                    expect(verifyUnsubscribeToken(buildUnsubscribeToken(id))).toBe(id);
                }
            ),
            { numRuns: 200, seed: 2026_05_02 }
        );
    });
});

// ===========================================================================
// Property 14 — Tampering / encoding / namespace
// Validates: Requirements 8.4, 8.5, 12.2
// ===========================================================================
describe("unsubscribe token — Property 14: tampering rejected", () => {
    const id = "11111111-2222-3333-4444-555555555555";

    it("rejects a flipped HMAC byte", () => {
        const token = buildUnsubscribeToken(id);
        const [head, sig] = token.split(".");
        // Flip the first hex character so the HMAC mismatches.
        const flipped = sig.startsWith("a") ? `b${sig.slice(1)}` : `a${sig.slice(1)}`;
        expect(verifyUnsubscribeToken(`${head}.${flipped}`)).toBeNull();
    });

    it("rejects a flipped payload byte", () => {
        const token = buildUnsubscribeToken(id);
        const [head, sig] = token.split(".");
        const flippedHead = head.startsWith("a") ? `b${head.slice(1)}` : `a${head.slice(1)}`;
        expect(verifyUnsubscribeToken(`${flippedHead}.${sig}`)).toBeNull();
    });

    it.each([
        "",
        "noseparator",
        "too.many.parts",
        "only.",
        ".only",
        // Non-hex sig
        `${Buffer.from(id).toString("base64url")}.notahex`,
        // Non-base64url body containing illegal chars
        "!@#$.0123456789abcdef",
    ])("rejects malformed token: %s", (token) => {
        expect(verifyUnsubscribeToken(token)).toBeNull();
    });

    it("rejects a wishlist-shaped token replayed against the unsubscribe verifier", () => {
        // Wishlist tokens use the same envelope but no `:marketing` namespace
        // suffix in the HMAC input. The marketing verifier must reject them
        // even when the customer id matches — otherwise a leaked share link
        // could be replayed as an opt-out.
        const wishlistToken = buildWishlistShareToken(id);
        expect(verifyUnsubscribeToken(wishlistToken)).toBeNull();
    });

    it("rejects a token whose payload decodes to empty string", () => {
        // base64url empty string -> "" (an empty Buffer). The `b64urlDecode`
        // helper yields "" rather than null in that case; the HMAC for
        // "" + ":marketing" is a deterministic hex but flipping its sig
        // proves the rejection path. We simply pass an empty body + bogus sig.
        expect(verifyUnsubscribeToken(".0123456789abcdef")).toBeNull();
    });

    // Property: random sig replacements never validate against an arbitrary id.
    it("random sigs never validate (property)", () => {
        fcAssert(
            fc.property(
                fc.string({ minLength: 1, maxLength: 32 }).filter((s) => s.length > 0),
                fc
                    .array(fc.constantFrom(..."0123456789abcdef".split("")), {
                        minLength: 64,
                        maxLength: 64,
                    })
                    .map((cs) => cs.join("")),
                (id, sig) => {
                    const head = Buffer.from(id, "utf8")
                        .toString("base64")
                        .replace(/=+$/u, "")
                        .replace(/\+/g, "-")
                        .replace(/\//g, "_");
                    const real = buildUnsubscribeToken(id);
                    const realSig = real.split(".")[1];
                    if (sig === realSig) return; // skip the (extremely unlikely) match
                    expect(verifyUnsubscribeToken(`${head}.${sig}`)).toBeNull();
                }
            ),
            { numRuns: 100, seed: 2026_05_03 }
        );
    });
});
