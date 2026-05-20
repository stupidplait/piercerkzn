/**
 * Product review validation. Mirrors `docs/04_BACKEND_ENDPOINTS.md` §4.
 *
 * Reviews are stored as `pending` until an admin approves them; only
 * `approved` rows are visible to non-owners.
 */
import { z } from "zod";
import { paginationSchema } from "./common";

export const productReviewSortValues = ["newest", "rating_desc", "rating_asc", "helpful"] as const;

export const listProductReviewsQuerySchema = paginationSchema.extend({
    sort: z.enum(productReviewSortValues).default("newest"),
});
export type ListProductReviewsQuery = z.infer<typeof listProductReviewsQuerySchema>;

/**
 * Body for `POST /api/products/[handle]/reviews`. Images are R2 public URLs that
 * the client previously obtained via `/api/uploads/finalize` with scope
 * `review_image`.
 */
export const createProductReviewSchema = z.object({
    rating: z.coerce.number().int().min(1).max(5),
    title: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(4_000).optional(),
    images: z.array(z.string().url().max(512)).max(10).optional(),
});
export type CreateProductReviewInput = z.infer<typeof createProductReviewSchema>;
