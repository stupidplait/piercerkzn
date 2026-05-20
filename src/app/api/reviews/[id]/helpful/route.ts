/**
 * POST /api/reviews/[id]/helpful — mark a review as helpful (idempotent).
 *
 * Each `(review_id, customer_id)` pair has a unique row in
 * `review_helpful_vote`; the route inserts the vote and bumps
 * `review.helpful_count` in the same transaction. A double-vote returns
 * `200 alreadyVoted=true` without changing the counter.
 *
 * Customer auth required so that anonymous votes can't bypass dedup.
 */
import { and, eq, sql } from "drizzle-orm";

import { applyRateLimit, fail, forbidden, internal, notFound, ok, requireUser } from "@/lib/api";
import { capture } from "@/lib/posthog";
import { db, reviewHelpfulVotes, reviews } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ id: string }>;
}

export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "auth");
    if (limited) return limited;

    const { id } = await ctx.params;

    const guard = await requireUser();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;
    if (!sess.customerId) return forbidden("Сессия не привязана к покупателю");
    const customerId = sess.customerId;

    try {
        return await db.transaction(async (tx) => {
            // Lock the review row so concurrent votes serialise on it.
            const [review] = await tx
                .select({
                    id: reviews.id,
                    helpfulCount: reviews.helpfulCount,
                    status: reviews.status,
                })
                .from(reviews)
                .where(eq(reviews.id, id))
                .limit(1)
                .for("update");
            if (!review) return notFound("Отзыв не найден");

            const [existing] = await tx
                .select({ id: reviewHelpfulVotes.id })
                .from(reviewHelpfulVotes)
                .where(
                    and(
                        eq(reviewHelpfulVotes.reviewId, id),
                        eq(reviewHelpfulVotes.customerId, customerId)
                    )
                )
                .limit(1);
            if (existing) {
                return ok({
                    review: { id: review.id, helpfulCount: review.helpfulCount ?? 0 },
                    alreadyVoted: true,
                });
            }

            await tx.insert(reviewHelpfulVotes).values({ reviewId: id, customerId });

            const [updated] = await tx
                .update(reviews)
                .set({
                    helpfulCount: sql`coalesce(${reviews.helpfulCount}, 0) + 1`,
                    updatedAt: new Date(),
                })
                .where(eq(reviews.id, id))
                .returning({ id: reviews.id, helpfulCount: reviews.helpfulCount });

            if (!updated) return fail("not_found", "Отзыв не найден", { status: 404 });

            capture({
                event: "review_helpful_voted",
                distinctId: customerId,
                properties: { review_id: updated.id },
            });

            return ok({
                review: { id: updated.id, helpfulCount: updated.helpfulCount ?? 0 },
                alreadyVoted: false,
            });
        });
    } catch (error) {
        console.error("[/api/reviews/:id/helpful] failed", error);
        return internal();
    }
}
