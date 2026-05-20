import { describe, it, expect } from "vitest";
import { windowSchema, intLikeSchema } from "@/lib/env";

describe("lib/env", () => {
    describe("windowSchema", () => {
        it.each(["5 m", "1 h", "30 s", "7 d"])("accepts valid window %s", (input) => {
            expect(windowSchema.safeParse(input).success).toBe(true);
        });

        it.each(["5", "5m", "five m", "1x", ""])("rejects invalid window %s", (input) => {
            expect(windowSchema.safeParse(input).success).toBe(false);
        });

        it("accepts undefined (optional)", () => {
            expect(windowSchema.safeParse(undefined).success).toBe(true);
        });
    });

    describe("intLikeSchema", () => {
        it.each(["0", "1", "100", "9999"])("accepts digits-only string %s", (input) => {
            const result = intLikeSchema.safeParse(input);
            expect(result.success).toBe(true);
            if (result.success) expect(result.data).toBe(Number(input));
        });

        it.each(["-1", "1.5", "abc", "", "1e2"])("rejects non-digit string %s", (input) => {
            expect(intLikeSchema.safeParse(input).success).toBe(false);
        });

        it("accepts undefined (optional)", () => {
            expect(intLikeSchema.safeParse(undefined).success).toBe(true);
        });
    });
});
