/**
 * GET /api/admin/reservations — paginated list with filters and search.
 *
 * Filters:
 *   - `status`  one of pending | confirmed | picked_up | cancelled | expired
 *   - `q`       search by reference number / customer email / customer phone
 *   - `from`, `to`  ISO date range applied to `created_at`
 *   - `sort`    newest (default) | oldest | expiring (asc by `expires_at`,
 *               useful for spotting holds about to lapse)
 */
import { and, asc, between, desc, eq, ilike, or, sql } from "drizzle-orm";

import { internal, ok, parseQuery, requireAdmin } from "@/lib/api";
import { db, reservations } from "@/db";
import { listAdminReservationsQuerySchema } from "@/lib/validations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
    const guard = await requireAdmin();
    if (guard.response) return guard.response;

    const url = new URL(req.url);
    const parsed = parseQuery(url, listAdminReservationsQuerySchema);
    if (!parsed.ok) return parsed.response!;
    const q = parsed.data!;

    try {
        const filters = [];
        if (q.status) filters.push(eq(reservations.status, q.status));
        if (q.q) {
            const like = `%${q.q}%`;
            filters.push(
                or(
                    ilike(reservations.referenceNumber, like),
                    ilike(reservations.customerEmail, like),
                    ilike(reservations.customerPhone, like)
                )!
            );
        }
        if (q.from && q.to) {
            filters.push(
                between(reservations.createdAt, new Date(q.from), new Date(`${q.to}T23:59:59Z`))
            );
        } else if (q.from) {
            filters.push(sql`${reservations.createdAt} >= ${new Date(q.from)}`);
        } else if (q.to) {
            filters.push(sql`${reservations.createdAt} <= ${new Date(`${q.to}T23:59:59Z`)}`);
        }
        const where = filters.length > 0 ? and(...filters) : undefined;

        const orderBy =
            q.sort === "expiring"
                ? [asc(reservations.expiresAt)]
                : q.sort === "oldest"
                  ? [asc(reservations.createdAt)]
                  : [desc(reservations.createdAt)];

        const rows = await db
            .select({
                id: reservations.id,
                referenceNumber: reservations.referenceNumber,
                status: reservations.status,
                total: reservations.total,
                customerId: reservations.customerId,
                customerFirstName: reservations.customerFirstName,
                customerLastName: reservations.customerLastName,
                customerEmail: reservations.customerEmail,
                customerPhone: reservations.customerPhone,
                createdAt: reservations.createdAt,
                expiresAt: reservations.expiresAt,
                confirmedAt: reservations.confirmedAt,
                pickedUpAt: reservations.pickedUpAt,
                cancelledAt: reservations.cancelledAt,
            })
            .from(reservations)
            .where(where)
            .orderBy(...orderBy)
            .limit(q.limit)
            .offset(q.offset);

        const totalQuery = db.select({ total: sql<number>`count(*)::int` }).from(reservations);
        const totalRow = await (where ? totalQuery.where(where) : totalQuery).then((r) => r[0]);

        return ok({
            reservations: rows,
            count: rows.length,
            total: totalRow.total,
            limit: q.limit,
            offset: q.offset,
        });
    } catch (error) {
        console.error("[/api/admin/reservations GET] failed", error);
        return internal();
    }
}
