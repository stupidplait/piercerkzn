/**
 * GET /api/admin/analytics/appointments
 *
 * - Volume per period (count by created_at bucket)
 * - Status distribution
 * - Cancellation + no-show rates
 * - Top-booked services
 */
import { between, desc, eq, sql } from "drizzle-orm";

import { internal, ok, parseQuery, requireAdmin } from "@/lib/api";
import { appointmentServices, appointments, db, services as servicesTable } from "@/db";
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
        const where = between(appointments.createdAt, range.from, range.to);
        const bucket = truncSql(appointments.createdAt, range.period);

        const [volumeRows, statusRows, aggRow, topServices] = await Promise.all([
            db
                .select({
                    bucket: sql<Date>`${bucket}`.as("bucket"),
                    count: sql<number>`count(*)::int`,
                })
                .from(appointments)
                .where(where)
                .groupBy(sql`bucket`)
                .orderBy(sql`bucket`),
            db
                .select({
                    status: appointments.status,
                    count: sql<number>`count(*)::int`,
                })
                .from(appointments)
                .where(where)
                .groupBy(appointments.status),
            db
                .select({
                    total: sql<number>`count(*)::int`,
                    completed: sql<number>`count(*) filter (where ${appointments.status} = 'completed')::int`,
                    cancelled: sql<number>`count(*) filter (where ${appointments.status} = 'cancelled')::int`,
                    noShow: sql<number>`count(*) filter (where ${appointments.status} = 'no_show')::int`,
                    avgDurationMin: sql<number>`coalesce(avg(${appointments.totalDurationMin}), 0)::int`,
                })
                .from(appointments)
                .where(where)
                .then((r) => r[0]),
            db
                .select({
                    serviceId: servicesTable.id,
                    serviceHandle: servicesTable.handle,
                    serviceName: servicesTable.name,
                    bookings: sql<number>`count(*)::int`,
                })
                .from(appointmentServices)
                .innerJoin(servicesTable, eq(servicesTable.id, appointmentServices.serviceId))
                .innerJoin(appointments, eq(appointments.id, appointmentServices.appointmentId))
                .where(where)
                .groupBy(servicesTable.id, servicesTable.handle, servicesTable.name)
                .orderBy(desc(sql`count(*)`))
                .limit(20),
        ]);

        const cancellationRate =
            aggRow.total > 0 ? Number(((aggRow.cancelled / aggRow.total) * 100).toFixed(1)) : 0;
        const noShowRate =
            aggRow.total > 0 ? Number(((aggRow.noShow / aggRow.total) * 100).toFixed(1)) : 0;
        const completionRate =
            aggRow.total > 0 ? Number(((aggRow.completed / aggRow.total) * 100).toFixed(1)) : 0;

        const statusDistribution = statusRows.reduce<Record<string, number>>((acc, r) => {
            acc[r.status ?? "unknown"] = r.count;
            return acc;
        }, {});

        // Comparison window
        const windowMs = range.to.getTime() - range.from.getTime();
        const prevFrom = new Date(range.from.getTime() - windowMs);
        const prevRow = await db
            .select({ total: sql<number>`count(*)::int` })
            .from(appointments)
            .where(between(appointments.createdAt, prevFrom, range.from))
            .then((r) => r[0]);
        const changePercent =
            prevRow.total > 0
                ? Number((((aggRow.total - prevRow.total) / prevRow.total) * 100).toFixed(1))
                : null;

        return ok({
            appointments: {
                period: range.period,
                from: range.from.toISOString(),
                to: range.to.toISOString(),
                total: aggRow.total,
                completed: aggRow.completed,
                cancelled: aggRow.cancelled,
                noShow: aggRow.noShow,
                completionRate,
                cancellationRate,
                noShowRate,
                averageDurationMin: aggRow.avgDurationMin,
                statusDistribution,
                volume: volumeRows.map((b) => ({
                    date: formatBucketLabel(new Date(b.bucket), range.period),
                    count: b.count,
                })),
                topServices,
                comparisonPreviousPeriod: {
                    total: prevRow.total,
                    changePercent,
                },
            },
        });
    } catch (error) {
        console.error("[/api/admin/analytics/appointments] failed", error);
        return internal();
    }
}
