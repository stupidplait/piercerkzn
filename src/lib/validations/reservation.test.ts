import { describe, it, expect } from "vitest";
import { createReservationSchema } from "@/lib/validations/reservation";
import { randomUUID } from "crypto";

describe("createReservationSchema - captchaToken", () => {
    const validBase = {
        items: [{ variantId: randomUUID(), quantity: 1 }],
        customer: {
            firstName: "Test",
            email: "test@example.com",
            phone: "+79001234567",
        },
    };

    it("rejects when captchaToken is missing", () => {
        const result = createReservationSchema.safeParse(validBase);
        expect(result.success).toBe(false);
    });

    it("rejects when captchaToken is empty string", () => {
        const result = createReservationSchema.safeParse({ ...validBase, captchaToken: "" });
        expect(result.success).toBe(false);
    });

    it("rejects when captchaToken is shorter than 20 characters", () => {
        const result = createReservationSchema.safeParse({ ...validBase, captchaToken: "short" });
        expect(result.success).toBe(false);
    });

    it("accepts captchaToken of exactly 20 characters", () => {
        const result = createReservationSchema.safeParse({
            ...validBase,
            captchaToken: "a".repeat(20),
        });
        expect(result.success).toBe(true);
    });

    it("accepts captchaToken of 2000 characters", () => {
        const result = createReservationSchema.safeParse({
            ...validBase,
            captchaToken: "x".repeat(2000),
        });
        expect(result.success).toBe(true);
    });

    it("rejects captchaToken longer than 2000 characters", () => {
        const result = createReservationSchema.safeParse({
            ...validBase,
            captchaToken: "x".repeat(2001),
        });
        expect(result.success).toBe(false);
    });
});
