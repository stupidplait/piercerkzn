import { describe, it, expect } from "vitest";
import { contactInquirySchema } from "@/lib/validations/contact";

describe("contactInquirySchema - captchaToken", () => {
    const validBase = {
        name: "Test User",
        email: "test@example.com",
        message: "This is a test message that is long enough",
    };

    it("rejects when captchaToken is missing", () => {
        const result = contactInquirySchema.safeParse(validBase);
        expect(result.success).toBe(false);
    });

    it("rejects when captchaToken is empty string", () => {
        const result = contactInquirySchema.safeParse({ ...validBase, captchaToken: "" });
        expect(result.success).toBe(false);
    });

    it("rejects when captchaToken is shorter than 20 characters", () => {
        const result = contactInquirySchema.safeParse({ ...validBase, captchaToken: "short" });
        expect(result.success).toBe(false);
    });

    it("accepts captchaToken of exactly 20 characters", () => {
        const result = contactInquirySchema.safeParse({
            ...validBase,
            captchaToken: "a".repeat(20),
        });
        expect(result.success).toBe(true);
    });

    it("accepts captchaToken of 2000 characters", () => {
        const result = contactInquirySchema.safeParse({
            ...validBase,
            captchaToken: "x".repeat(2000),
        });
        expect(result.success).toBe(true);
    });

    it("rejects captchaToken longer than 2000 characters", () => {
        const result = contactInquirySchema.safeParse({
            ...validBase,
            captchaToken: "x".repeat(2001),
        });
        expect(result.success).toBe(false);
    });
});
