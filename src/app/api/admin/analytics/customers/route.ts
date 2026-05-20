/**
 * GET /api/admin/analytics/customers
 *
 * - New customers per period (signups by created_at bucket)
 * - Returning rate: customers with ≥2 picked-up reservations in window
 * - Top customers by spend (sum of picked_up reservation totals)
 */
import { and, between, desc, eq, isNull, sql } from "drizzle-orm";

import { internal, ok, parseQuery, requireAdmin } from "@/lib/api";
import { customers, db, reservations } from "@/db";
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
        const newWhere = and(
            isNull(customers.deletedAt),
            between(customers.createdAt, range.from, range.to)
        );
        const newBucket = truncSql(customers.createdAt, range.period);

        const pickedUpWhere = and(
            eq(reservations.status, "picked_up"),
            between(reservations.pickedUpAt, range.from, range.to)
        );

        const [newRows, newTotalRow, returningRow, topSpendersRow] = await Promise.all([
            db
                .select({
                    bucket: sql<Date>`${newBucket}`.as("bucket"),
                    count: sql<number>`count(*)::int`,
                })
                .from(customers)
                .where(newWhere)
                .groupBy(sql`bucket`)
                .orderBy(sql`bucket`),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(customers)
                .where(newWhere)
                .then((r) => r[0]),
            db
                .select({
                    activeCustomers: sql<number>`count(distinct ${reservations.customerId})::int`,
                    returningCustomers: sql<number>`(
                        select count(*)::int from (
                            select ${reservations.customerId}, count(*) as c
                            from ${reservations}
                            where ${reservations.status} = 'picked_up'
                              and ${reservations.pickedUpAt} between ${range.from} and ${range.to}
                              and ${reservations.customerId} is not null
                            group by ${reservations.customerId}
                            having count(*) >= 2
                        ) t
                    )`,
                })
                .from(reservations)
                .where(pickedUpWhere)
                .then((r) => r[0]),
            db
                .select({
                    customerId: customers.id,
                    firstName: customers.firstName,
                    lastName: customers.lastName,
                    email: customers.email,
                    spend: sql<number>`coalesce(sum(${reservations.total}), 0)::int`,
                    orderCount: sql<number>`count(${reservations.id})::int`,
                })
                .from(customers)
                .innerJoin(reservations, eq(reservations.customerId, customers.id))
                .where(pickedUpWhere)
                .groupBy(customers.id, customers.firstName, customers.lastName, customers.email)
                .orderBy(desc(sql`coalesce(sum(${reservations.total}), 0)`))
                .limit(20),
        ]);

        const returningRate =
            returningRow.activeCustomers > 0
                ? Number(
                      (
                          (returningRow.returningCustomers / returningRow.activeCustomers) *
                          100
                      ).toFixed(1)
                  )
                : 0;

        const aov =
            topSpendersRow.length > 0
                ? Math.round(
                      topSpendersRow.reduce((acc, r) => acc + r.spend, 0) /
                          Math.max(
                              topSpendersRow.reduce((acc, r) => acc + r.orderCount, 0),
                              1
                          )
                  )
                : 0;

        return ok({
            customers: {
                period: range.period,
                from: range.from.toISOString(),
                to: range.to.toISOString(),
                newCount: newTotalRow.count,
                activeCount: returningRow.activeCustomers,
                returningCount: returningRow.returningCustomers,
                returningRate,
                averageOrderValue: aov,
                newOverTime: newRows.map((b) => ({
                    date: formatBucketLabel(new Date(b.bucket), range.period),
                    count: b.count,
                })),
                topByLifetimeSpend: topSpendersRow.map((r) => ({
                    customerId: r.customerId,
                    name: [r.firstName, r.lastName ? `${r.lastName[0]}.` : ""]
                        .filter(Boolean)
                        .join(" ")
                        .trim(),
                    email: r.email,
                    spend: r.spend,
                    orderCount: r.orderCount,
                })),
            },
        });
    } catch (error) {
        console.error("[/api/admin/analytics/customers] failed", error);
        return internal();
    }
}
