/**
 * DELETE /api/wishlist/[productId] — remove a product from the wishlist.
 *
 * Idempotent: removing a product that isn't in the wishlist still returns 204.
 */
import { and, eq } from "drizzle-orm";

import { forbidden, internal, noContent, requireUser } from "@/lib/api";
import { db, wishlistItems } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ productId: string }>;
}

export async function DELETE(_req: Request, ctx: RouteContext) {
    const guard = await requireUser();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;
    if (!sess.customerId) return forbidden("Сессия не привязана к покупателю");

    const { productId } = await ctx.params;

    try {
        await db
            .delete(wishlistItems)
            .where(
                and(
                    eq(wishlistItems.customerId, sess.customerId),
                    eq(wishlistItems.productId, productId)
                )
            );
        return noContent();
    } catch (error) {
        console.error("[/api/wishlist/:productId DELETE] failed", error);
        return internal();
    }
}
