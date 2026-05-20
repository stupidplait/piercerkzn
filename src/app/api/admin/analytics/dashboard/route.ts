/**
 * GET /api/admin/analytics/dashboard
 *
 * Headline counters for the admin home screen — meant to be one cheap-ish
 * query per metric, no period bucketing. Use the per-report endpoints for
 * deeper drilldowns.
 */
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { internal, ok, requireAdmin } from "@/lib/api";
import { appointments, customers, db, notificationLogs, reservations, reviews } from "@/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    try {
        const today = new Date().toISOString().slice(0, 10);
        const last30 = new Date(Date.now() - 30 * 86_400_000);

        const [
            revenueRow,
            activeReservationsRow,
            pendingReservationsRow,
            upcomingAppointmentsRow,
            todaysAppointmentsRow,
            pendingReviewsRow,
            newCustomersRow,
            failedNotificationsRow,
        ] = await Promise.all([
            db
                .select({
                    total: sql<number>`coalesce(sum(${reservations.total}), 0)::int`,
                    count: sql<number>`count(*)::int`,
                })
                .from(reservations)
                .where(
                    and(eq(reservations.status, "picked_up"), gte(reservations.pickedUpAt, last30))
                )
                .then((r) => r[0]),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(reservations)
                .where(inArray(reservations.status, ["pending", "confirmed"]))
                .then((r) => r[0]),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(reservations)
                .where(eq(reservations.status, "pending"))
                .then((r) => r[0]),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(appointments)
                .where(
                    and(
                        gte(appointments.date, today),
                        inArray(appointments.status, ["pending", "confirmed"])
                    )
                )
                .then((r) => r[0]),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(appointments)
                .where(
                    and(
                        eq(appointments.date, today),
                        inArray(appointments.status, ["pending", "confirmed", "in_progress"])
                    )
                )
                .then((r) => r[0]),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(reviews)
                .where(eq(reviews.status, "pending"))
                .then((r) => r[0]),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(customers)
                .where(and(isNull(customers.deletedAt), gte(customers.createdAt, last30)))
                .then((r) => r[0]),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(notificationLogs)
                .where(
                    and(eq(notificationLogs.status, "failed"), gte(notificationLogs.sentAt, last30))
                )
                .then((r) => r[0]),
        ]);

        return ok({
            window: { lookbackDays: 30 },
            revenueLast30d: {
                total: revenueRow.total,
                pickedUpCount: revenueRow.count,
                currencyCode: "rub",
            },
            reservations: {
                active: activeReservationsRow.count,
                pending: pendingReservationsRow.count,
            },
            appointments: {
                upcoming: upcomingAppointmentsRow.count,
                today: todaysAppointmentsRow.count,
            },
            reviews: { pendingModeration: pendingReviewsRow.count },
            customers: { newLast30d: newCustomersRow.count },
            notifications: { failedLast30d: failedNotificationsRow.count },
        });
    } catch (error) {
        console.error("[/api/admin/analytics/dashboard] failed", error);
        return internal();
    }
}
