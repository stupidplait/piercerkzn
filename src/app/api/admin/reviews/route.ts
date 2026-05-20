/**
 * GET /api/admin/reviews — moderation queue.
 *
 * Filters: `status` (default: pending), `productId`. Sort: newest | oldest.
 * Returns the customer-name + product-handle joined for quick context.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { internal, ok, parseQuery, requireAdmin } from "@/lib/api";
import { customers, db, products, reviews } from "@/db";
import { listAdminReviewsQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, listAdminReviewsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.status) filters.push(eq(reviews.status, q.status));
        if (q.productId) filters.push(eq(reviews.productId, q.productId));
        const where = filters.length > 0 ? and(...filters) : undefined;

        const orderBy = q.sort === "oldest" ? [asc(reviews.createdAt)] : [desc(reviews.createdAt)];

        const baseQuery = db
            .select({
                id: reviews.id,
                type: reviews.type,
                productId: reviews.productId,
                productHandle: products.handle,
                productTitle: products.title,
                customerId: reviews.customerId,
                customerFirstName: customers.firstName,
                customerLastName: customers.lastName,
                customerEmail: customers.email,
                rating: reviews.rating,
                title: reviews.title,
                content: reviews.content,
                images: reviews.images,
                status: reviews.status,
                helpfulCount: reviews.helpfulCount,
                isVerifiedClient: reviews.isVerifiedClient,
                createdAt: reviews.createdAt,
            })
            .from(reviews)
            .leftJoin(customers, eq(reviews.customerId, customers.id))
            .leftJoin(products, eq(reviews.productId, products.id));

        const rows = await (where ? baseQuery.where(where) : baseQuery)
            .orderBy(...orderBy)
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(reviews);
        const totalRow = await (where ? totalQuery.where(where) : totalQuery).then((r) => r[0]);

        return ok({
            reviews: rows,
            count: rows.length,
            total: totalRow.total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/reviews GET] failed", error);
        return internal();
    }
}
