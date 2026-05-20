/**
 * PUT /api/admin/reviews/[id]/approve — make a review publicly visible.
 *
 * Idempotent: re-approving an already-approved review returns the same row.
 */
import { eq } from "drizzle-orm";

import { internal, notFound, ok, requireAdmin } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { db, reviews } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function PUT(_req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    const { id } = await ctx.params;

    try {
        const [updated] = await db
            .update(reviews)
            .set({ status: "approved", updatedAt: new Date() })
            .where(eq(reviews.id, id))
            .returning({
                id: reviews.id,
                productId: reviews.productId,
                status: reviews.status,
                rating: reviews.rating,
            });

        if (!updated) return notFound("Отзыв не найден");

        capture({
            event: "review_approved",
            distinctId: sess.userId,
            properties: { review_id: updated.id, product_id: updated.productId },
        });

        return ok({ review: updated });
    } catch (error) {
        console.error("[/api/admin/reviews/:id/approve] failed", error);
        return internal();
    }
}
