/**
 * PUT /api/admin/reviews/[id]/reject — flip a review to `rejected`.
 *
 * Body (optional): { reason: "..." }. The reason is logged via PostHog for
 * audit; the schema doesn't have a column to store it on the review row.
 */
import { eq } from "drizzle-orm";

import { internal, notFound, ok, parseJson, requireAdmin } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { db, reviews } from "@/db";
import { rejectReviewSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function PUT(req: Request, ctx: RouteContext) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    const { id } = await ctx.params;

    let reason: string | undefined;
    if (req.headers.get("content-length") && req.headers.get("content-type")?.includes("json")) {
        const parsed = await parseJson(req, rejectReviewSchema);
        if (!parsed.ok) return parsed.response!;
        reason = parsed.data!.reason;
    }

    try {
        const [updated] = await db
            .update(reviews)
            .set({ status: "rejected", updatedAt: new Date() })
            .where(eq(reviews.id, id))
            .returning({
                id: reviews.id,
                productId: reviews.productId,
                status: reviews.status,
            });
        if (!updated) return notFound("Отзыв не найден");

        capture({
            event: "review_rejected",
            distinctId: sess.userId,
            properties: { review_id: updated.id, product_id: updated.productId, reason },
        });

        return ok({ review: updated });
    } catch (error) {
        console.error("[/api/admin/reviews/:id/reject] failed", error);
        return internal();
    }
}
