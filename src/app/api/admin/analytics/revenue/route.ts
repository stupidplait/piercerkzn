/**
 * GET /api/admin/analytics/revenue
 *
 * Reservation-based revenue: only `picked_up` reservations count (cash was
 * actually paid). Bucketed per `period` (daily | weekly | monthly).
 *
 * Also returns a category breakdown over the same window via
 * reservation_items → products → product_categories.
 */
import { and, between, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";

import { internal, ok, parseQuery, requireAdmin } from "@/lib/api";
import { db, productCategories, products, reservationItems, reservations } from "@/db";
import { formatBucketLabel, resolveAnalyticsRange, truncSql } from "@/lib/admin/analytics";
import { analyticsRangeSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, analyticsRangeSchema);
    if (!parsed.ok) return parsed.response!;
    const range = resolveAnalyticsRange(parsed.data!);

    try {
        const where = and(
            eq(reservations.status, "picked_up"),
            between(reservations.pickedUpAt, range.from, range.to)
        );

        const bucket = truncSql(reservations.pickedUpAt, range.period);

        const buckets = await db
            .select({
                bucket: sql<Date>`${bucket}`.as("bucket"),
                amount: sql<number>`coalesce(sum(${reservations.total}), 0)::int`,
                count: sql<number>`count(*)::int`,
            })
            .from(reservations)
            .where(where)
            .groupBy(sql`bucket`)
            .orderBy(sql`bucket`);

        const totalRow = await db
            .select({
                total: sql<number>`coalesce(sum(${reservations.total}), 0)::int`,
                count: sql<number>`count(*)::int`,
            })
            .from(reservations)
            .where(where)
            .then((r) => r[0]);

        // Comparison window: same length immediately before `from`.
        const windowMs = range.to.getTime() - range.from.getTime();
        const prevFrom = new Date(range.from.getTime() - windowMs);
        const prevRow = await db
            .select({
                total: sql<number>`coalesce(sum(${reservations.total}), 0)::int`,
            })
            .from(reservations)
            .where(
                and(
                    eq(reservations.status, "picked_up"),
                    gte(reservations.pickedUpAt, prevFrom),
                    lte(reservations.pickedUpAt, range.from)
                )
            )
            .then((r) => r[0]);

        const changePercent =
            prevRow.total > 0
                ? Number((((totalRow.total - prevRow.total) / prevRow.total) * 100).toFixed(1))
                : null;

        const categoryRows = await db
            .select({
                categoryId: productCategories.id,
                categoryName: productCategories.name,
                amount: sql<number>`coalesce(sum(${reservationItems.total}), 0)::int`,
            })
            .from(reservationItems)
            .innerJoin(reservations, eq(reservations.id, reservationItems.reservationId))
            .leftJoin(products, eq(products.id, reservationItems.productId))
            .leftJoin(
                productCategories,
                and(eq(productCategories.id, products.categoryId), isNull(products.deletedAt))
            )
            .where(where)
            .groupBy(productCategories.id, productCategories.name)
            .orderBy(desc(sql`coalesce(sum(${reservationItems.total}), 0)`))
            .limit(20);

        const totalForPercent = totalRow.total > 0 ? totalRow.total : 1;
        const byCategory = categoryRows.map((c) => ({
            categoryId: c.categoryId,
            category: c.categoryName ?? "Без категории",
            amount: c.amount,
            percentage: Number(((c.amount / totalForPercent) * 100).toFixed(1)),
        }));

        return ok({
            revenue: {
                total: totalRow.total,
                pickedUpCount: totalRow.count,
                currencyCode: "rub",
                period: range.period,
                from: range.from.toISOString(),
                to: range.to.toISOString(),
                data: buckets.map((b) => ({
                    date: formatBucketLabel(new Date(b.bucket), range.period),
                    amount: b.amount,
                    orderCount: b.count,
                })),
                byCategory,
                comparisonPreviousPeriod: {
                    total: prevRow.total,
                    changePercent,
                },
            },
        });
    } catch (error) {
        console.error("[/api/admin/analytics/revenue] failed", error);
        return internal();
    }
}
