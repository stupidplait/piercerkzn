// Feature: public-form-abuse-hardening, Property 21: fcAssert numRuns floor
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// We mock the fast-check module to intercept fc.assert calls and capture params
let capturedParams: { numRuns?: number } | undefined;

vi.mock("fast-check", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fast-check")>();
    return {
        ...actual,
        default: {
            ...actual.default,
            assert: (_property: unknown, params?: { numRuns?: number }) => {
                capturedParams = params;
            },
        },
    };
});

describe("fcAssert numRuns floor", () => {
    const originalEnv = process.env.FAST_CHECK_NUM_RUNS;

    beforeEach(() => {
        vi.resetModules();
        capturedParams = undefined;
        delete process.env.FAST_CHECK_NUM_RUNS;
    });

    afterEach(() => {
        if (originalEnv !== undefined) {
            process.env.FAST_CHECK_NUM_RUNS = originalEnv;
        } else {
            delete process.env.FAST_CHECK_NUM_RUNS;
        }
    });

    it("resolves numRuns ≥ 100 for any params.numRuns value", async () => {
        const { fcAssert, fc } = await import("@/test/property/fc-config");

        const inputs: (number | undefined)[] = [undefined, 0, -1, -1000, 1, 50, 99, 100, 200];
        for (const numRuns of inputs) {
            capturedParams = undefined;
            const prop = fc.property(fc.constant(1), () => {});
            fcAssert(prop, numRuns !== undefined ? { numRuns } : {});
            expect(capturedParams).toBeDefined();
            expect(capturedParams!.numRuns).toBeGreaterThanOrEqual(100);
        }
    });

    it("respects FAST_CHECK_NUM_RUNS env when > 100", async () => {
        process.env.FAST_CHECK_NUM_RUNS = "300";
        const { fcAssert, fc } = await import("@/test/property/fc-config");

        const prop = fc.property(fc.constant(1), () => {});
        fcAssert(prop);
        expect(capturedParams!.numRuns).toBe(300);
    });

    it("clamps FAST_CHECK_NUM_RUNS env to floor when < 100", async () => {
        process.env.FAST_CHECK_NUM_RUNS = "10";
        const { fcAssert, fc } = await import("@/test/property/fc-config");

        const prop = fc.property(fc.constant(1), () => {});
        fcAssert(prop);
        expect(capturedParams!.numRuns).toBe(100);
    });
});
