/**
 * GET /api/piercer/reviews — studio-level reviews ("type=studio") for `/about`.
 *
 * Single-piercer studio: there is no per-artist filter — these are reviews of
 * the studio/piercer as a whole. Product-specific reviews are returned by
 * `/api/products/[handle]/reviews` (Phase 2 follow-up).
 *
 * Only `status = 'approved'` reviews are visible. Customer first names + last
 * initials are exposed; full last names and emails are not.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { internal, ok, parseQuery } from "@/lib/api";
import { customers, db, reviews } from "@/db";
import { piercerReviewsQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const url = new URL(req.url);
    const parsed = parseQuery(url, piercerReviewsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const where = and(eq(reviews.type, "studio"), eq(reviews.status, "approved"));

        const sortClause =
            q.sort === "rating_desc"
                ? [desc(reviews.rating), desc(reviews.createdAt)]
                : q.sort === "rating_asc"
                  ? [asc(reviews.rating), desc(reviews.createdAt)]
                  : [desc(reviews.createdAt)];

        const rows = await db
            .select({
                id: reviews.id,
                rating: reviews.rating,
                title: reviews.title,
                content: reviews.content,
                images: reviews.images,
                isVerifiedClient: reviews.isVerifiedClient,
                helpfulCount: reviews.helpfulCount,
                createdAt: reviews.createdAt,
                customerFirstName: customers.firstName,
                customerLastName: customers.lastName,
            })
            .from(reviews)
            .leftJoin(customers, eq(reviews.customerId, customers.id))
            .where(where)
            .orderBy(...sortClause)
            .limit(q.limit)
            .offset(q.offset);

        const [totalRow, summaryRow] = await Promise.all([
            db
                .select({ total: sql<number>`count(*)::int` })
                .from(reviews)
                .where(where)
                .then((r) => r[0]),
            db
                .select({
                    average: sql<number>`coalesce(avg(${reviews.rating})::numeric(3,2), 0)`,
                    count: sql<number>`count(*)::int`,
                    star5: sql<number>`count(*) filter (where ${reviews.rating} = 5)::int`,
                    star4: sql<number>`count(*) filter (where ${reviews.rating} = 4)::int`,
                    star3: sql<number>`count(*) filter (where ${reviews.rating} = 3)::int`,
                    star2: sql<number>`count(*) filter (where ${reviews.rating} = 2)::int`,
                    star1: sql<number>`count(*) filter (where ${reviews.rating} = 1)::int`,
                })
                .from(reviews)
                .where(where)
                .then((r) => r[0]),
        ]);

        const sanitized = rows.map((r) => {
            const lastInitial = r.customerLastName ? `${r.customerLastName[0]}.` : "";
            const author = [r.customerFirstName, lastInitial].filter(Boolean).join(" ").trim();
            return {
                id: r.id,
                rating: r.rating,
                title: r.title,
                content: r.content,
                images: r.images ?? [],
                isVerifiedClient: r.isVerifiedClient ?? false,
                helpfulCount: r.helpfulCount ?? 0,
                createdAt: r.createdAt,
                author: author || "Аноним",
            };
        });

        return ok({
            reviews: sanitized,
            count: sanitized.length,
            total: totalRow.total,
            summary: {
                average: Number(summaryRow.average),
                count: summaryRow.count,
                distribution: {
                    5: summaryRow.star5,
                    4: summaryRow.star4,
                    3: summaryRow.star3,
                    2: summaryRow.star2,
                    1: summaryRow.star1,
                },
            },
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/piercer/reviews] failed", error);
        return internal();
    }
}
