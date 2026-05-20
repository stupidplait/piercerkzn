/**
 * Unit tests for the typed callback-data parser/formatter.
 *
 * Covers:
 *   - Property 1: Callback round-trip — `parseX(formatX(cb)) ≡ cb` for every
 *     kind in both `ReserveCallback` and `BookCallback`.
 *   - 64-byte invariant on every formatter output.
 *   - Defensive parsing — every parser returns `null` (never throws) on
 *     malformed input, including arbitrary garbage strings.
 *
 * Validates: Requirements 2.7, 3.5
 */
import { fc, fcAssert } from "@/test/property/fc-config";
import { describe, expect, it } from "vitest";
import {
    type BookCallback,
    type ReserveCallback,
    formatBook,
    formatReserve,
    parseBook,
    parseReserve,
} from "./callback-data";

const TG_CALLBACK_LIMIT = 64;

function utf8ByteLength(s: string): number {
    return Buffer.byteLength(s, "utf8");
}

// ---------------------------------------------------------------------------
// Generators carved to the input space.
// IDs avoid the `:` separator (Telegram lets us pick our own grammar; we
// simply forbid the delimiter inside ID fields). The `String.includes(":")`
// guard mirrors what the real flow modules pass in (UUIDs / slugs without
// colons).
// ---------------------------------------------------------------------------
const idArb = fc
    .string({ minLength: 1, maxLength: 24 })
    .filter((s) => !s.includes(":") && s.length > 0)
    .filter((s) => utf8ByteLength(s) <= 24);

// Page index: any non-negative integer that doesn't push the payload past
// 64 bytes. The longest fixed prefix is `rsv:prod:<id>:p:` (15 bytes); with
// `idArb` capped at 24 bytes that leaves > 20 bytes for the page number,
// far more than we need.
const pageArb = fc.nat({ max: 9_999 });

const isoDateArb = fc.constantFrom(
    "2026-05-16",
    "2026-05-17",
    "2026-12-01",
    "2027-01-01",
    "2030-12-31"
);

const hhmmArb = fc.constantFrom("00:00", "09:30", "10:00", "13:45", "18:00", "23:59");

const reserveCallbackArb: fc.Arbitrary<ReserveCallback> = fc.oneof(
    idArb.map((categoryId) => ({ kind: "category" as const, categoryId })),
    fc
        .tuple(idArb, pageArb)
        .map(([productId, page]) => ({ kind: "product" as const, productId, page })),
    pageArb.map((page) => ({ kind: "productPage" as const, page })),
    idArb.map((variantId) => ({ kind: "variant" as const, variantId })),
    fc.constant({ kind: "confirm" as const }),
    fc.constant({ kind: "cancel" as const }),
    fc.constant({ kind: "back" as const }),
    fc.constant({ kind: "start" as const })
);

const bookCallbackArb: fc.Arbitrary<BookCallback> = fc.oneof(
    idArb.map((serviceId) => ({ kind: "service" as const, serviceId })),
    isoDateArb.map((date) => ({ kind: "date" as const, date })),
    hhmmArb.map((time) => ({ kind: "time" as const, time })),
    pageArb.map((page) => ({ kind: "timePage" as const, page })),
    fc.constant({ kind: "confirm" as const }),
    fc.constant({ kind: "cancel" as const }),
    fc.constant({ kind: "back" as const }),
    fc.constant({ kind: "start" as const })
);

// ---------------------------------------------------------------------------
// Property 1 — Callback round-trip
// ---------------------------------------------------------------------------
describe("Property 1: Callback round-trip", () => {
    it("parseReserve(formatReserve(cb)) ≡ cb for every reserve kind", () => {
        fcAssert(
            fc.property(reserveCallbackArb, (cb) => {
                const raw = formatReserve(cb);
                const parsed = parseReserve(raw);
                expect(parsed).toEqual(cb);
            }),
            { numRuns: 200, seed: 17480 }
        );
    });

    it("parseBook(formatBook(cb)) ≡ cb for every book kind", () => {
        fcAssert(
            fc.property(bookCallbackArb, (cb) => {
                const raw = formatBook(cb);
                const parsed = parseBook(raw);
                expect(parsed).toEqual(cb);
            }),
            { numRuns: 200, seed: 17481 }
        );
    });
});

// ---------------------------------------------------------------------------
// 64-byte invariant
// ---------------------------------------------------------------------------
describe("64-byte invariant", () => {
    it("byteLength(formatReserve(cb)) ≤ 64 for every reserve kind", () => {
        fcAssert(
            fc.property(reserveCallbackArb, (cb) => {
                const raw = formatReserve(cb);
                expect(utf8ByteLength(raw)).toBeLessThanOrEqual(TG_CALLBACK_LIMIT);
            }),
            { numRuns: 200, seed: 17482 }
        );
    });

    it("byteLength(formatBook(cb)) ≤ 64 for every book kind", () => {
        fcAssert(
            fc.property(bookCallbackArb, (cb) => {
                const raw = formatBook(cb);
                expect(utf8ByteLength(raw)).toBeLessThanOrEqual(TG_CALLBACK_LIMIT);
            }),
            { numRuns: 200, seed: 17483 }
        );
    });
});

// ---------------------------------------------------------------------------
// Defensive parsing — never throw, always return null on garbage
// ---------------------------------------------------------------------------
describe("defensive parsing", () => {
    it("parseReserve returns null for arbitrary garbage strings", () => {
        fcAssert(
            fc.property(fc.string({ maxLength: 80 }), (raw) => {
                // Skip strings that happen to be valid by chance.
                const parsed = parseReserve(raw);
                if (parsed !== null) {
                    // Round-trip must hold for valid hits.
                    expect(formatReserve(parsed)).toEqual(raw);
                } else {
                    // Acceptable — malformed input maps to null.
                    expect(parsed).toBeNull();
                }
            }),
            { numRuns: 300, seed: 17484 }
        );
    });

    it("parseBook returns null for arbitrary garbage strings", () => {
        fcAssert(
            fc.property(fc.string({ maxLength: 80 }), (raw) => {
                const parsed = parseBook(raw);
                if (parsed !== null) {
                    expect(formatBook(parsed)).toEqual(raw);
                } else {
                    expect(parsed).toBeNull();
                }
            }),
            { numRuns: 300, seed: 17485 }
        );
    });

    it("parseReserve never throws", () => {
        fcAssert(
            fc.property(fc.string({ maxLength: 200 }), (raw) => {
                expect(() => parseReserve(raw)).not.toThrow();
            }),
            { numRuns: 200, seed: 17486 }
        );
    });

    it("parseBook never throws", () => {
        fcAssert(
            fc.property(fc.string({ maxLength: 200 }), (raw) => {
                expect(() => parseBook(raw)).not.toThrow();
            }),
            { numRuns: 200, seed: 17487 }
        );
    });

    it("parseReserve rejects empty / wrong-prefix inputs", () => {
        expect(parseReserve("")).toBeNull();
        expect(parseReserve("rsv")).toBeNull();
        expect(parseReserve("bk:cnf")).toBeNull();
        expect(parseReserve("rsv:")).toBeNull();
        expect(parseReserve("rsv:unknown")).toBeNull();
    });

    it("parseBook rejects empty / wrong-prefix inputs", () => {
        expect(parseBook("")).toBeNull();
        expect(parseBook("bk")).toBeNull();
        expect(parseBook("rsv:cnf")).toBeNull();
        expect(parseBook("bk:")).toBeNull();
        expect(parseBook("bk:unknown")).toBeNull();
    });

    it("parseReserve rejects malformed product page (negative / non-digit)", () => {
        expect(parseReserve("rsv:prod:abc:p:-1")).toBeNull();
        expect(parseReserve("rsv:prod:abc:p:01a")).toBeNull();
        expect(parseReserve("rsv:prod:abc:q:0")).toBeNull(); // not "p"
        expect(parseReserve("rsv:prod:abc:p:")).toBeNull(); // empty page
    });

    it("parseReserve rejects malformed productPage (negative / float)", () => {
        expect(parseReserve("rsv:prodpage:-1")).toBeNull();
        expect(parseReserve("rsv:prodpage:1.5")).toBeNull();
        expect(parseReserve("rsv:prodpage:")).toBeNull();
    });

    it("parseBook rejects malformed dates", () => {
        expect(parseBook("bk:date:")).toBeNull();
        expect(parseBook("bk:date:2026/05/16")).toBeNull();
        expect(parseBook("bk:date:not-a-date")).toBeNull();
        expect(parseBook("bk:date:2026-5-16")).toBeNull();
    });

    it("parseBook rejects malformed times", () => {
        // "bk:time:" produces 2 parts after split — invalid (need 4 parts).
        expect(parseBook("bk:time:")).toBeNull();
        expect(parseBook("bk:time:9:30")).toBeNull(); // single-digit hour
        expect(parseBook("bk:time:1030")).toBeNull(); // missing colon
        expect(parseBook("bk:time:ab:cd")).toBeNull(); // non-digit
        // The parser deliberately validates wire-format only (`\d{2}:\d{2}`),
        // not hour/minute ranges — values come from server-generated buttons.
    });

    it("parseBook rejects malformed timePage", () => {
        expect(parseBook("bk:time_page:-1")).toBeNull();
        expect(parseBook("bk:time_page:abc")).toBeNull();
        expect(parseBook("bk:time_page:")).toBeNull();
    });

    it("parsers reject extra trailing fields on terminal kinds", () => {
        expect(parseReserve("rsv:cnf:extra")).toBeNull();
        expect(parseReserve("rsv:cancel:extra")).toBeNull();
        expect(parseReserve("rsv:back:extra")).toBeNull();
        expect(parseReserve("rsv:start:extra")).toBeNull();
        expect(parseBook("bk:cnf:extra")).toBeNull();
        expect(parseBook("bk:cancel:extra")).toBeNull();
        expect(parseBook("bk:back:extra")).toBeNull();
        expect(parseBook("bk:start:extra")).toBeNull();
    });
});

// ---------------------------------------------------------------------------
// Concrete example assertions — pin the wire format
// ---------------------------------------------------------------------------
describe("formatter wire format (golden)", () => {
    it("formatReserve fixed shapes", () => {
        expect(formatReserve({ kind: "category", categoryId: "abc" })).toEqual("rsv:cat:abc");
        expect(formatReserve({ kind: "product", productId: "abc", page: 0 })).toEqual(
            "rsv:prod:abc:p:0"
        );
        expect(formatReserve({ kind: "productPage", page: 3 })).toEqual("rsv:prodpage:3");
        expect(formatReserve({ kind: "variant", variantId: "var-1" })).toEqual("rsv:var:var-1");
        expect(formatReserve({ kind: "confirm" })).toEqual("rsv:cnf");
        expect(formatReserve({ kind: "cancel" })).toEqual("rsv:cancel");
        expect(formatReserve({ kind: "back" })).toEqual("rsv:back");
        expect(formatReserve({ kind: "start" })).toEqual("rsv:start");
    });

    it("formatBook fixed shapes", () => {
        expect(formatBook({ kind: "service", serviceId: "svc-1" })).toEqual("bk:svc:svc-1");
        expect(formatBook({ kind: "date", date: "2026-05-16" })).toEqual("bk:date:2026-05-16");
        expect(formatBook({ kind: "time", time: "10:30" })).toEqual("bk:time:10:30");
        expect(formatBook({ kind: "timePage", page: 0 })).toEqual("bk:time_page:0");
        expect(formatBook({ kind: "confirm" })).toEqual("bk:cnf");
        expect(formatBook({ kind: "cancel" })).toEqual("bk:cancel");
        expect(formatBook({ kind: "back" })).toEqual("bk:back");
        expect(formatBook({ kind: "start" })).toEqual("bk:start");
    });
});
