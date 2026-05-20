/**
 * Contact / inquiry form validation.
 * Mirrors `docs/04_BACKEND_ENDPOINTS.md` §16.
 */
import { z } from "zod";
import { emailSchema, nameSchema, phoneSchema } from "./common";

export const contactInquirySchema = z.object({
    name: nameSchema,
    email: emailSchema,
    phone: phoneSchema.optional(),
    subject: z.string().trim().min(1).max(200).optional(),
    message: z.string().trim().min(10, "Сообщение слишком короткое").max(5_000),
    /** hCaptcha / Turnstile token; verified server-side. Required per Req 2.4 / 10.1. */
    captchaToken: z.string().min(20).max(2_000),
});
export type ContactInquiryInput = z.infer<typeof contactInquirySchema>;
