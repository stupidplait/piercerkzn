/**
 * GET /api/admin/analytics/orders — reservation-volume analytics.
 *
 * "Orders" maps to reservations in this stack (no online checkout).
 * Returns: per-period volume + status distribution + AOV + conversion rate
 * (picked_up / total non-pending) within the window.
 */
import { and, between, sql } from "drizzle-orm";

import { internal, ok, parseQuery, requireAdmin } from "@/lib/api";
import { db, reservations } from "@/db";
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
        const where = between(reservations.createdAt, range.from, range.to);
        const bucket = truncSql(reservations.createdAt, range.period);

        const [volumeRows, statusRows, aggRow] = await Promise.all([
            db
                .select({
                    bucket: sql<Date>`${bucket}`.as("bucket"),
                    count: sql<number>`count(*)::int`,
                })
                .from(reservations)
                .where(where)
                .groupBy(sql`bucket`)
                .orderBy(sql`bucket`),
            db
                .select({
                    status: reservations.status,
                    count: sql<number>`count(*)::int`,
                })
                .from(reservations)
                .where(where)
                .groupBy(reservations.status),
            db
                .select({
                    total: sql<number>`count(*)::int`,
                    pickedUp: sql<number>`count(*) filter (where ${reservations.status} = 'picked_up')::int`,
                    revenue: sql<number>`coalesce(sum(${reservations.total}) filter (where ${reservations.status} = 'picked_up'), 0)::int`,
                })
                .from(reservations)
                .where(where)
                .then((r) => r[0]),
        ]);

        // AOV = total revenue / picked_up count (picked_up is the only state
        // where actual cash was exchanged).
        const aov = aggRow.pickedUp > 0 ? Math.round(aggRow.revenue / aggRow.pickedUp) : 0;
        const conversionRate =
            aggRow.total > 0 ? Number(((aggRow.pickedUp / aggRow.total) * 100).toFixed(1)) : 0;

        const statusDistribution = statusRows.reduce<Record<string, number>>((acc, r) => {
            acc[r.status ?? "unknown"] = r.count;
            return acc;
        }, {});

        // Cancellation reasons could be parsed from `internal_notes` later;
        // for now we only count by status.
        const cancellations = statusDistribution.cancelled ?? 0;
        const expirations = statusDistribution.expired ?? 0;

        // Comparison window
        const windowMs = range.to.getTime() - range.from.getTime();
        const prevFrom = new Date(range.from.getTime() - windowMs);
        const prevRow = await db
            .select({
                total: sql<number>`count(*)::int`,
            })
            .from(reservations)
            .where(and(between(reservations.createdAt, prevFrom, range.from)))
            .then((r) => r[0]);
        const changePercent =
            prevRow.total > 0
                ? Number((((aggRow.total - prevRow.total) / prevRow.total) * 100).toFixed(1))
                : null;

        return ok({
            orders: {
                period: range.period,
                from: range.from.toISOString(),
                to: range.to.toISOString(),
                total: aggRow.total,
                pickedUp: aggRow.pickedUp,
                cancellations,
                expirations,
                revenue: aggRow.revenue,
                averageOrderValue: aov,
                conversionRate,
                statusDistribution,
                volume: volumeRows.map((b) => ({
                    date: formatBucketLabel(new Date(b.bucket), range.period),
                    count: b.count,
                })),
                comparisonPreviousPeriod: {
                    total: prevRow.total,
                    changePercent,
                },
            },
        });
    } catch (error) {
        console.error("[/api/admin/analytics/orders] failed", error);
        return internal();
    }
}
