/**
 * /api/products/[handle]/reviews
 *
 *   GET  — paginated list of approved reviews, plus rating distribution.
 *   POST — submit a new review (auth required, verified-client gated;
 *          starts in `pending` until an admin approves).
 *
 * The route key is the product `handle` (storefront URL slug); the reviews
 * table joins on the resolved product `id` internally.
 *
 * Customer last names are exposed only as initials ("Алина И.").
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import {
    applyRateLimit,
    fail,
    forbidden,
    internal,
    notFound,
    ok,
    parseJson,
    parseQuery,
    requireUser,
} from "@/lib/api";
import { capture } from "@/lib/posthog";
import { customers, db, products, reviews } from "@/db";
import { isVerifiedStudioClient } from "@/lib/reviews";
import { createProductReviewSchema, listProductReviewsQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
    params: Promise<{ handle: string }>;
}

/**
 * Resolve a published product handle to its internal id, or `null` if the
 * product does not exist (or is unpublished / soft-deleted).
 */
async function resolveProductId(handle: string): Promise<string | null> {
    const [row] = await db
        .select({ id: products.id })
        .from(products)
        .where(
            and(
                eq(products.handle, handle),
                eq(products.status, "published"),
                isNull(products.deletedAt)
            )
        )
        .limit(1);
    return row?.id ?? null;
}

function authorLabel(firstName: string | null, lastName: string | null): string {
    const first = firstName?.trim() ?? "";
    const lastInitial = lastName?.trim()?.[0] ? `${lastName.trim()[0]}.` : "";
    const composed = [first, lastInitial].filter(Boolean).join(" ").trim();
    return composed || "Аноним";
}

// ---------------------------------------------------------------------------
// GET — list approved reviews + summary
// ---------------------------------------------------------------------------
export async function GET(req: Request, ctx: RouteContext) {
    const { handle } = await ctx.params;

    const url = new URL(req.url);
    const parsed = parseQuery(url, listProductReviewsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const productId = await resolveProductId(handle);
        if (!productId) return notFound("Товар не найден");

        const where = and(
            eq(reviews.productId, productId),
            eq(reviews.type, "product"),
            eq(reviews.status, "approved")
        );

        const orderBy =
            q.sort === "rating_desc"
                ? [desc(reviews.rating), desc(reviews.createdAt)]
                : q.sort === "rating_asc"
                  ? [asc(reviews.rating), desc(reviews.createdAt)]
                  : q.sort === "helpful"
                    ? [desc(reviews.helpfulCount), desc(reviews.createdAt)]
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
            .orderBy(...orderBy)
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

        return ok({
            reviews: rows.map((r) => ({
                id: r.id,
                rating: r.rating,
                title: r.title,
                content: r.content,
                images: r.images ?? [],
                isVerifiedClient: r.isVerifiedClient ?? false,
                helpfulCount: r.helpfulCount ?? 0,
                createdAt: r.createdAt,
                author: authorLabel(r.customerFirstName, r.customerLastName),
            })),
            count: rows.length,
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
        console.error("[/api/products/:handle/reviews GET] failed", error);
        return internal();
    }
}

// ---------------------------------------------------------------------------
// POST — submit a new review (verified-client gated, starts `pending`)
// ---------------------------------------------------------------------------
export async function POST(req: Request, ctx: RouteContext) {
    const limited = await applyRateLimit(req, "contact"); // 3 / 5min — review spam guard
    if (limited) return limited;

    const { handle } = await ctx.params;

    const guard = await requireUser();
    if (guard.response) return guard.response;
    const sess = guard.ctx!;
    if (!sess.customerId) return forbidden("Сессия не привязана к покупателю");

    const parsed = await parseJson(req, createProductReviewSchema);
    if (!parsed.ok) return parsed.response!;
    const input = parsed.data!;

    try {
        const productId = await resolveProductId(handle);
        if (!productId) return notFound("Товар не найден");

        const verified = await isVerifiedStudioClient(sess.customerId);
        if (!verified) {
            return fail("not_verified_client", "Оставлять отзывы могут только клиенты студии", {
                status: 403,
            });
        }

        // One review per (customer, product). PUT /reviews/:id (deferred) is
        // the canonical edit path.
        const [existing] = await db
            .select({ id: reviews.id })
            .from(reviews)
            .where(
                and(
                    eq(reviews.customerId, sess.customerId),
                    eq(reviews.productId, productId),
                    eq(reviews.type, "product")
                )
            )
            .limit(1);
        if (existing) {
            return fail("already_reviewed", "Вы уже оставили отзыв на этот товар", { status: 409 });
        }

        const [inserted] = await db
            .insert(reviews)
            .values({
                type: "product",
                productId,
                customerId: sess.customerId,
                rating: input.rating,
                title: input.title ?? null,
                content: input.content ?? null,
                images: input.images && input.images.length > 0 ? input.images : null,
                isVerifiedClient: true,
                helpfulCount: 0,
                status: "pending",
            })
            .returning();

        capture({
            event: "product_review_submitted",
            distinctId: sess.customerId,
            properties: {
                review_id: inserted.id,
                product_id: productId,
                rating: input.rating,
                has_content: Boolean(input.content),
                image_count: input.images?.length ?? 0,
            },
        });

        return ok(
            {
                review: {
                    id: inserted.id,
                    rating: inserted.rating,
                    title: inserted.title,
                    content: inserted.content,
                    images: inserted.images ?? [],
                    status: inserted.status,
                    isVerifiedClient: inserted.isVerifiedClient,
                    helpfulCount: inserted.helpfulCount ?? 0,
                    createdAt: inserted.createdAt,
                },
                message: "Отзыв отправлен на модерацию",
            },
            { status: 201 }
        );
    } catch (error) {
        console.error("[/api/products/:handle/reviews POST] failed", error);
        return internal();
    }
}
