/**
 * Zod schemas for `/api/uploads/*`.
 *
 * Kept intentionally tiny — the meaningful validation (MIME / size /
 * auth role) lives in `@/lib/uploads` so that scope rules are not
 * duplicated. The schemas here only enforce shape.
 */
import { z } from "zod";

const uploadScopeSchema = z.enum([
    "review_image",
    "portfolio_image",
    "product_image",
    "blog_image",
    "model_3d",
    "waiver_signature",
]);

export const presignUploadSchema = z.object({
    scope: uploadScopeSchema,
    contentType: z
        .string()
        .trim()
        .min(1)
        .max(127)
        // RFC 6838 — `type/subtype`, no parameters.
        .regex(/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i, "Некорректный Content-Type"),
    contentLength: z.coerce.number().int().positive(),
    filename: z.string().trim().max(255).optional(),
});
export type PresignUploadInput = z.infer<typeof presignUploadSchema>;

export const finalizeUploadSchema = z.object({
    scope: uploadScopeSchema,
    key: z
        .string()
        .trim()
        .min(1)
        .max(512)
        // Defence-in-depth — no traversal, no leading slash.
        .regex(/^[A-Za-z0-9._\-/]+$/u, "Некорректный ключ объекта")
        .refine((k) => !k.includes(".."), { message: "Некорректный ключ объекта" }),
});
export type FinalizeUploadInput = z.infer<typeof finalizeUploadSchema>;
