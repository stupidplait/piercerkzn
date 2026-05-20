/**
 * DELETE /api/reviews/[id] — customer deletes their own review.
 *
 * Admin/staff sessions may delete any review. Both cases hard-delete the row
 * (no soft-delete column exists on `review`); admin moderation rejects via
 * status changes, not deletion, so this is safe.
 */
import { eq } from "drizzle-orm";

import { fail, forbidden, internal, noContent, notFound, requireUser } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { db, reviews } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function DELETE(_req: Request, ctx: RouteContext) {
    const { id } = await ctx.params;

    const guard = await requireUser();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;

    try {
        const [row] = await db
            .select({
                id: reviews.id,
                customerId: reviews.customerId,
                productId: reviews.productId,
            })
            .from(reviews)
            .where(eq(reviews.id, id))
            .limit(1);
        if (!row) return notFound("Отзыв не найден");

        const isOwner = !!sess.customerId && row.customerId === sess.customerId;
        const isAdmin = sess.role === "admin" || sess.role === "staff";
        if (!isOwner && !isAdmin) return forbidden("Это не ваш отзыв");

        const result = await db
            .delete(reviews)
            .where(eq(reviews.id, id))
            .returning({ id: reviews.id });
        if (result.length === 0) {
            return fail("conflict", "Отзыв уже удалён", { status: 409 });
        }

        capture({
            event: "review_deleted",
            distinctId: sess.customerId ?? sess.userId,
            properties: { review_id: id, by: isAdmin ? "admin" : "customer" },
        });

        return noContent();
    } catch (error) {
        console.error("[/api/reviews/:id DELETE] failed", error);
        return internal();
    }
}
