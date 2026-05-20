import { afterEach, describe, expect, it, vi } from "vitest";

import fc from "fast-check";

import { isTelegramMiniApp, isTelegramMiniAppFromParams, TG_MINI_COOKIE } from "./mini-app";

// ---------------------------------------------------------------------------
// `next/headers` is mocked at the module-graph level so we can drive
// `cookies().get(TG_MINI_COOKIE)` deterministically. The mock holds a single
// shared cookie value that each test sets via `setMockCookie`.
// ---------------------------------------------------------------------------
let mockCookieValue: string | undefined;

function setMockCookie(value: string | undefined): void {
    mockCookieValue = value;
}

vi.mock("next/headers", () => ({
    cookies: async () => ({
        get: (name: string) =>
            name === TG_MINI_COOKIE && mockCookieValue !== undefined
                ? { name, value: mockCookieValue }
                : undefined,
    }),
}));

afterEach(() => {
    setMockCookie(undefined);
});

// ---------------------------------------------------------------------------
// Existing query-param coverage
// ---------------------------------------------------------------------------

describe("mini-app — isTelegramMiniAppFromParams", () => {
    it("detects `?tgmini=1` via URLSearchParams", () => {
        const p = new URLSearchParams("tgmini=1");
        expect(isTelegramMiniAppFromParams(p)).toBe(true);
    });

    it("accepts the textual `true` alias", () => {
        const p = new URLSearchParams("tgmini=true");
        expect(isTelegramMiniAppFromParams(p)).toBe(true);
    });

    it("treats `0` / `false` as not-mini", () => {
        expect(isTelegramMiniAppFromParams(new URLSearchParams("tgmini=0"))).toBe(false);
        expect(isTelegramMiniAppFromParams(new URLSearchParams("tgmini=false"))).toBe(false);
    });

    it("returns false when the flag is absent", () => {
        expect(isTelegramMiniAppFromParams(new URLSearchParams(""))).toBe(false);
        expect(isTelegramMiniAppFromParams({})).toBe(false);
    });

    it("works with the Next.js plain-object searchParams shape", () => {
        expect(isTelegramMiniAppFromParams({ tgmini: "1" })).toBe(true);
        expect(isTelegramMiniAppFromParams({ tgmini: ["1"] })).toBe(true);
        expect(isTelegramMiniAppFromParams({ tgmini: ["0"] })).toBe(false);
    });

    it("ignores unrecognised values (defensive)", () => {
        expect(isTelegramMiniAppFromParams({ tgmini: "yes" })).toBe(false);
        expect(isTelegramMiniAppFromParams({ tgmini: "" })).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Cookie-path coverage (Task 9.1)
// ---------------------------------------------------------------------------

describe("mini-app — isTelegramMiniApp (cookie path)", () => {
    /** Validates: Requirements 1.3 (Property 4). */
    it("returns true when the sticky cookie is set and the query param is absent", async () => {
        setMockCookie("1");
        await expect(isTelegramMiniApp({})).resolves.toBe(true);
    });

    /** Validates: Requirements 1.4 (Property 5). */
    it("honours `tgmini=0` as an explicit override even when the cookie is set", async () => {
        setMockCookie("1");
        await expect(isTelegramMiniApp({ tgmini: "0" })).resolves.toBe(false);
    });

    /** Validates: Requirements 1.4 (Property 5). */
    it("honours `tgmini=false` as an explicit override even when the cookie is set", async () => {
        setMockCookie("1");
        await expect(isTelegramMiniApp({ tgmini: "false" })).resolves.toBe(false);
    });

    it("returns false when neither query param nor cookie is set", async () => {
        setMockCookie(undefined);
        await expect(isTelegramMiniApp({})).resolves.toBe(false);
    });

    it("returns false when the cookie is some unrelated value", async () => {
        setMockCookie("0");
        await expect(isTelegramMiniApp({})).resolves.toBe(false);
    });

    it("returns true when both signals agree (`tgmini=1` + cookie)", async () => {
        setMockCookie("1");
        await expect(isTelegramMiniApp({ tgmini: "1" })).resolves.toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Property 4 — predicate monotonicity over the (tgmini, cookie) cross-product.
// ---------------------------------------------------------------------------

describe("mini-app — Property 4: predicate monotonicity", () => {
    /** Validates: Requirements 1.2, 1.3, 1.4 (Property 4). */
    it("returns true iff tgmini='1'/'true' OR (cookie='1' AND tgmini ∉ {'0','false'})", async () => {
        // The complete parameter space: a small finite alphabet of meaningful
        // values plus a noise value to model "anything else". Anything outside
        // the recognised vocabulary is treated as "absent" by the helper.
        const tgminiArb = fc.constantFrom<string | undefined>(
            "1",
            "0",
            "true",
            "false",
            "yes", // unrecognised — treated as "no flag"
            "",
            undefined
        );
        const cookieArb = fc.constantFrom<string | undefined>("1", "0", undefined);

        await fcAssert(
            fc.asyncProperty(tgminiArb, cookieArb, async (tgmini, cookie) => {
                setMockCookie(cookie);
                const params: Record<string, string | string[] | undefined> =
                    tgmini === undefined ? {} : { tgmini };
                const actual = await isTelegramMiniApp(params);

                const queryTrue = tgmini === "1" || tgmini === "true";
                const queryFalse = tgmini === "0" || tgmini === "false";
                const cookieTrue = cookie === "1";
                const expected = queryTrue || (cookieTrue && !queryFalse);

                expect(actual).toBe(expected);
            }),
            { numRuns: 50 }
        );
    });
});
