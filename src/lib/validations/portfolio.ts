/**
 * Admin portfolio image mutation validation.
 *
 * Mirrors the columns on `portfolio_image`. `clientConsent` defaults to
 * `true` at the DB layer; admin-side toggles are still allowed so a
 * specific image can be hidden from the public list without deleting the row.
 */
import { z } from "zod";

import { uuidSchema } from "./common";

const piercingTypeSchema = z.string().trim().min(1).max(50);

export const createPortfolioImageSchema = z.object({
    imageUrl: z.string().url().max(512),
    thumbnailUrl: z.string().url().max(512).nullable().optional(),
    piercingType: piercingTypeSchema.nullable().optional(),
    productId: uuidSchema.nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
    /** Defaults to `true` at the DB layer. */
    clientConsent: z.boolean().optional(),
    sortOrder: z.coerce.number().int().optional(),
});
export type CreatePortfolioImageInput = z.infer<typeof createPortfolioImageSchema>;

export const updatePortfolioImageSchema = z.object({
    imageUrl: z.string().url().max(512).optional(),
    thumbnailUrl: z.string().url().max(512).nullable().optional(),
    piercingType: piercingTypeSchema.nullable().optional(),
    productId: uuidSchema.nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
    clientConsent: z.boolean().optional(),
    sortOrder: z.coerce.number().int().optional(),
});
export type UpdatePortfolioImageInput = z.infer<typeof updatePortfolioImageSchema>;

// ---------------------------------------------------------------------------
// List filter (admin)
// ---------------------------------------------------------------------------
export const adminListPortfolioImagesQuerySchema = z.object({
    piercingType: piercingTypeSchema.optional(),
});
export type AdminListPortfolioImagesQuery = z.infer<typeof adminListPortfolioImagesQuerySchema>;
