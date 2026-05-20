import { z } from "zod";
import { uuidSchema } from "./common";

export const addWishlistItemSchema = z.object({
    productId: uuidSchema,
});
export type AddWishlistItemInput = z.infer<typeof addWishlistItemSchema>;
